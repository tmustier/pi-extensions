use napi::Result as NapiResult;
use napi_derive::napi;
use std::io::{ErrorKind, Read, Write};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[napi(object)]
pub struct WeatherProcessSnapshot {
	pub stdout: String,
	pub stderr: String,
	pub exited: bool,
	pub exit_code: Option<i32>,
	pub exit_signal: Option<String>,
}

struct SpawnedProcess {
	child: Child,
	stdin: ChildStdin,
}

#[napi]
pub struct NativeWeatherProcess {
	script_path: String,
	weathr_path: String,
	args: Vec<String>,
	config_home: String,
	columns: u16,
	rows: u16,
	child: Option<Child>,
	stdin: Option<ChildStdin>,
	stdout_buffer: Arc<Mutex<Vec<u8>>>,
	stderr_buffer: Arc<Mutex<Vec<u8>>>,
	exited: bool,
	exit_code: Option<i32>,
	exit_signal: Option<String>,
}

#[napi]
impl NativeWeatherProcess {
	#[napi(constructor)]
	pub fn new(
		script_path: String,
		weathr_path: String,
		args: Vec<String>,
		config_home: String,
		columns: u16,
		rows: u16,
	) -> Self {
		let stdout_buffer = Arc::new(Mutex::new(Vec::new()));
		let stderr_buffer = Arc::new(Mutex::new(Vec::new()));

		let (child, stdin, exited, exit_signal) = match spawn_weathr_process(
			&script_path,
			&weathr_path,
			&args,
			&config_home,
			columns,
			rows,
			stdout_buffer.clone(),
			stderr_buffer.clone(),
		) {
			Ok(spawned) => (Some(spawned.child), Some(spawned.stdin), false, None),
			Err(error) => {
				let message = format!("Failed to start native weather bridge: {error}");
				if let Ok(mut stderr) = stderr_buffer.lock() {
					stderr.extend_from_slice(message.as_bytes());
				}
				(None, None, true, Some("start error".to_owned()))
			}
		};

		Self {
			script_path,
			weathr_path,
			args,
			config_home,
			columns,
			rows,
			child,
			stdin,
			stdout_buffer,
			stderr_buffer,
			exited,
			exit_code: None,
			exit_signal,
		}
	}

	#[napi]
	pub fn poll(&mut self) -> WeatherProcessSnapshot {
		self.update_exit_state();
		WeatherProcessSnapshot {
			stdout: take_buffer_string(&self.stdout_buffer),
			stderr: take_buffer_string(&self.stderr_buffer),
			exited: self.exited,
			exit_code: self.exit_code,
			exit_signal: self.exit_signal.clone(),
		}
	}

	#[napi]
	pub fn write_input(&mut self, input: String) -> bool {
		if self.exited {
			return false;
		}
		let Some(stdin) = self.stdin.as_mut() else {
			return false;
		};
		if stdin.write_all(input.as_bytes()).is_err() {
			return false;
		}
		stdin.flush().is_ok()
	}

	#[napi]
	pub fn stop(&mut self) {
		if self.exited {
			return;
		}

		let _ = self.write_input("q".to_owned());
		thread::sleep(Duration::from_millis(100));

		self.stdin = None;
		let Some(mut child) = self.child.take() else {
			self.exited = true;
			self.exit_code = None;
			self.exit_signal = Some("stopped".to_owned());
			return;
		};

		let status = match child.try_wait() {
			Ok(Some(status)) => Some(status),
			Ok(None) => {
				let _ = child.kill();
				child.wait().ok()
			}
			Err(_) => None,
		};

		if let Some(status) = status {
			self.record_exit_status(status);
		} else {
			self.exited = true;
			self.exit_code = None;
			self.exit_signal = Some("terminated".to_owned());
		}
	}

	#[napi]
	pub fn restart(&mut self) -> NapiResult<()> {
		self.stop();
		self.exited = false;
		self.exit_code = None;
		self.exit_signal = None;

		let stdout_buffer = Arc::new(Mutex::new(Vec::new()));
		let stderr_buffer = Arc::new(Mutex::new(Vec::new()));
		let spawned = spawn_weathr_process(
			&self.script_path,
			&self.weathr_path,
			&self.args,
			&self.config_home,
			self.columns,
			self.rows,
			stdout_buffer.clone(),
			stderr_buffer.clone(),
		)?;

		self.child = Some(spawned.child);
		self.stdin = Some(spawned.stdin);
		self.stdout_buffer = stdout_buffer;
		self.stderr_buffer = stderr_buffer;
		Ok(())
	}

	#[napi]
	pub fn resize(&mut self, columns: u16, rows: u16) -> NapiResult<()> {
		self.columns = columns;
		self.rows = rows;
		self.restart()
	}

	#[napi]
	pub fn is_running(&mut self) -> bool {
		self.update_exit_state();
		!self.exited
	}
}

impl NativeWeatherProcess {
	fn update_exit_state(&mut self) {
		if self.exited {
			return;
		}
		let Some(child) = self.child.as_mut() else {
			return;
		};

		match child.try_wait() {
			Ok(Some(status)) => {
				self.stdin = None;
				self.child = None;
				self.record_exit_status(status);
			}
			Ok(None) => {}
			Err(error) => {
				self.stdin = None;
				self.child = None;
				self.exited = true;
				self.exit_code = None;
				self.exit_signal = Some(format!("wait error: {error}"));
			}
		}
	}

	fn record_exit_status(&mut self, status: ExitStatus) {
		self.exited = true;
		self.exit_code = status.code();
		self.exit_signal = exit_signal_label(status);
	}
}

impl Drop for NativeWeatherProcess {
	fn drop(&mut self) {
		self.stop();
	}
}

fn spawn_weathr_process(
	script_path: &str,
	weathr_path: &str,
	args: &[String],
	config_home: &str,
	columns: u16,
	rows: u16,
	stdout_buffer: Arc<Mutex<Vec<u8>>>,
	stderr_buffer: Arc<Mutex<Vec<u8>>>,
) -> NapiResult<SpawnedProcess> {
	let escaped_binary = shell_quote(weathr_path);
	let escaped_args = args
		.iter()
		.map(|value| shell_quote(value))
		.collect::<Vec<String>>()
		.join(" ");
	let weather_command = if escaped_args.is_empty() {
		escaped_binary
	} else {
		format!("{escaped_binary} {escaped_args}")
	};
	let shell_command = format!("stty cols {columns} rows {rows}; exec {weather_command}");

	let mut command = Command::new(script_path);
	command
		.arg("-q")
		.arg("/dev/null")
		.arg("sh")
		.arg("-c")
		.arg(shell_command)
		.env("XDG_CONFIG_HOME", config_home)
		.env_remove("NO_COLOR")
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());

	if std::env::var_os("COLORTERM").is_none() {
		command.env("COLORTERM", "truecolor");
	}
	if std::env::var_os("TERM").is_none() {
		command.env("TERM", "xterm-256color");
	}

	let mut child = command.spawn().map_err(|error| {
		napi::Error::from_reason(format!("Failed to start weather process: {error}"))
	})?;

	let stdin = child
		.stdin
		.take()
		.ok_or_else(|| napi::Error::from_reason("Failed to open weather stdin".to_owned()))?;
	let stdout = child
		.stdout
		.take()
		.ok_or_else(|| napi::Error::from_reason("Failed to open weather stdout".to_owned()))?;
	let stderr = child
		.stderr
		.take()
		.ok_or_else(|| napi::Error::from_reason("Failed to open weather stderr".to_owned()))?;

	spawn_reader_thread(stdout, stdout_buffer);
	spawn_reader_thread(stderr, stderr_buffer);

	Ok(SpawnedProcess { child, stdin })
}

fn spawn_reader_thread<R>(mut reader: R, buffer: Arc<Mutex<Vec<u8>>>)
where
	R: Read + Send + 'static,
{
	thread::spawn(move || {
		let mut chunk = [0_u8; 8192];
		loop {
			match reader.read(&mut chunk) {
				Ok(0) => break,
				Ok(size) => {
					let Ok(mut shared) = buffer.lock() else {
						break;
					};
					shared.extend_from_slice(&chunk[..size]);
				}
				Err(error) if error.kind() == ErrorKind::Interrupted => continue,
				Err(_) => break,
			}
		}
	});
}

fn take_buffer_string(buffer: &Arc<Mutex<Vec<u8>>>) -> String {
	let Ok(mut shared) = buffer.lock() else {
		return String::new();
	};
	if shared.is_empty() {
		return String::new();
	}
	let bytes = std::mem::take(&mut *shared);
	String::from_utf8_lossy(&bytes).into_owned()
}

fn shell_quote(value: &str) -> String {
	format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn exit_signal_label(status: ExitStatus) -> Option<String> {
	#[cfg(unix)]
	{
		status.signal().map(|signal| signal.to_string())
	}
	#[cfg(not(unix))]
	{
		let _ = status;
		None
	}
}
