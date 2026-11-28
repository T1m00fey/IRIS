import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './ui/button'

export function Pagination({ offset, limit, total, setOffset }: { offset: number; limit: number; total: number; setOffset: (value: number) => void }) {
  return <nav className="pagination" aria-label="Страницы списка">
    <span>{offset + 1}–{Math.min(offset + limit, total)} из {total}</span>
    <div className="actions">
      <Button aria-label="Предыдущая страница" className="icon-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}><ChevronLeft size={15} /></Button>
      <Button aria-label="Следующая страница" className="icon-button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}><ChevronRight size={15} /></Button>
    </div>
  </nav>
}
