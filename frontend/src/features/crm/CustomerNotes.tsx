import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/button'
import { formatDate } from '../../lib/format'
import { CrmState } from './CrmElements'

interface CustomerNote {
  id: number
  text: string
  author_name: string
  created_at: string
}

export function CustomerNotes({ customerId }: { customerId: string }) {
  const [text, setText] = useState('')
  const client = useQueryClient()
  const path = '/api/v1/customers/' + encodeURIComponent(customerId) + '/notes'
  const key = ['customers', customerId, 'notes']
  const notes = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<CustomerNote[]>(path, { signal }),
  })
  const save = useMutation({
    mutationFn: (value: string) => api<CustomerNote>(path, { method: 'POST', body: JSON.stringify({ text: value }) }),
    onSuccess: async () => {
      setText('')
      await client.invalidateQueries({ queryKey: key, exact: true })
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (text.trim() && !save.isPending) save.mutate(text.trim())
  }

  return (
    <section className="panel crm-section crm-notes" aria-labelledby="crm-notes-heading">
      <h2 id="crm-notes-heading">Заметки о клиенте</h2>
      <form className="note-form" onSubmit={submit}>
        <label>Новая заметка
          <textarea className="field" rows={3} maxLength={4000} disabled={save.isPending} value={text}
            onChange={(event) => { save.reset(); setText(event.target.value) }} />
        </label>
        <div className="actions">
          <Button variant="primary" type="submit" disabled={save.isPending || !text.trim()}>
            {save.isPending ? 'Сохранение…' : 'Сохранить заметку'}
          </Button>
          {save.isSuccess && <span role="status" className="muted">Заметка сохранена</span>}
        </div>
        {save.isError && <p className="alert" role="alert">{save.error.message}</p>}
      </form>
      {notes.isPending && <CrmState title="Загрузка заметок…" />}
      {notes.isError && (
        <CrmState title="Не удалось загрузить заметки" description={notes.error.message} error>
          <Button onClick={() => void notes.refetch()}>Повторить</Button>
        </CrmState>
      )}
      {notes.data && (notes.data.length ? (
        <ol className="timeline crm-notes-history">
          {notes.data.map((note) => (
            <li key={note.id}>
              <p>{note.text}</p>
              <small>{note.author_name} · <time dateTime={note.created_at}>{formatDate(note.created_at)}</time></small>
            </li>
          ))}
        </ol>
      ) : !notes.isError && <CrmState title="Заметок о клиенте пока нет" />)}
    </section>
  )
}
