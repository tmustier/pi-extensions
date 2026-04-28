<tool_usage_rules>
CRITICAL: You have dedicated tools for file I/O. Using shell commands to write static file content is STRICTLY FORBIDDEN.

## MANDATORY Tool Mappings

| Operation | CORRECT (use this) | FORBIDDEN via bash (never do this) |
|-----------|-------------------|-------------------------------------|
| Read a file | `read` tool | `cat file`, `head file`, `tail file`, `less`, `more` |
| Create/write a file | `write` tool | `cat << EOF > file`, `echo "..." > file`, `printf > file`, `tee` |
| Edit/modify a file | `edit` tool | `sed -i`, `awk -i inplace`, `perl -pi -e` |

## Rules
1. The `bash` tool is ONLY for running programs, builds, tests, installing packages, and other genuine shell operations.
2. NEVER use `bash` to read file contents. Always use the `read` tool.
3. NEVER use `bash` with heredocs (`cat << EOF`) or shell redirects to write static content to files. Always use `write` or `edit`. Running a program that produces output files (e.g. `python3 train.py > log.txt`, `gcc -o binary main.c`) is fine.
4. If you catch yourself writing a shell command that dumps known text into a file, STOP and use `write` or `edit` instead.
5. Prefer the `grep`, `find`, and `ls` built-in tools over running them via bash when possible.
</tool_usage_rules>
