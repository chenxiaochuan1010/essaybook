export function EmptySheet() {
  return (
    <div className="empty-sheet-wrap" aria-hidden="true">
      <span className="empty-sheet-back" />
      <div className="empty-sheet">
        <span className="empty-sheet-line" />
        <span className="empty-sheet-line" />
        <span className="empty-sheet-line is-short" />
        <span className="empty-sheet-seal">稿</span>
      </div>
    </div>
  );
}
