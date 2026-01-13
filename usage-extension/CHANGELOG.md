# Changelog

## 0.1.2 - 2026-01-13
- Add loading spinner while parsing session files (Esc to cancel)
- Make data loading async to keep UI responsive
- Thanks @nicobailon

## 0.1.1 - 2026-01-12
- Deduplicate assistant messages across branched sessions to avoid double-counting
- Tokens total now excludes cache read/write tokens (cache remains in Cache column)
- Thanks @nicobailon

## 0.1.0 - 2026-01-10
- Initial release
- Collapsible provider/model view
- Three time periods: Today, This Week, All Time
- Token breakdown columns (dimmed for de-emphasis)
