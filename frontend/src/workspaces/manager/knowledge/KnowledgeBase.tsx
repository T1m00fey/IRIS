import { useDeferredValue, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api } from '../../../api/client'
import { PageHeading } from '../../../components/PageHeading'
import { PageState } from '../../../components/PageState'
import { Pagination } from '../../../components/Pagination'
import { StatusBadge } from '../../../components/StatusBadge'
import { Button } from '../../../components/ui/button'
import { formatDate } from '../../../lib/format'
import './knowledge.css'

const path = '/manager/knowledge'
const endpoint = '/api/v1/knowledge/articles'
const listKey = ['knowledge', 'list']
const limit = 20
const categories = {
  company: 'Компания, услуги и тарифы',
  offers: 'Акции и спецпредложения',
  instructions: 'Инструкции и регламенты',
  troubleshooting: 'Типовые проблемы и решения',
  faq: 'Частые вопросы',
} as const
const statuses = {
  draft: { label: 'Черновик', tone: 'neutral' },
  published: { label: 'Опубликована', tone: 'success' },
  archived: { label: 'В архиве', tone: 'neutral' },
} as const

type Category = keyof typeof categories
type ArticleStatus = keyof typeof statuses
type ArticleInput = { title: string; category: Category; body: string }
type ArticleSummary = Omit<ArticleInput, 'body'> & {
  id: string
  status: ArticleStatus
  updated_at: string
  published_at: string | null
  has_unpublished_changes: boolean
}
type Article = ArticleSummary & { body: string; version: number }

function ArticleBadge({ status }: { status: ArticleStatus }) {
  return <StatusBadge tone={statuses[status].tone}>{statuses[status].label}</StatusBadge>
}

export function KnowledgeBase() {
  const [filters, setFilters] = useSearchParams()
  const search = filters.get('q')?.slice(0, 200) || ''
  const q = useDeferredValue(search.trim())
  const category = filters.get('category') || ''
  const status = filters.get('status') || ''
  const pageOffset = Number(filters.get('offset'))
  const offset = Number.isInteger(pageOffset) && pageOffset >= 0 && pageOffset <= 2147483647 ? pageOffset : 0
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (q) params.set('q', q)
  if (Object.hasOwn(categories, category)) params.set('category', category)
  if (Object.hasOwn(statuses, status)) params.set('status', status)
  const query = useQuery({
    queryKey: [...listKey, params.toString()],
    queryFn: ({ signal }) => api<{ items: ArticleSummary[]; total: number }>(endpoint + '?' + params, { signal }),
  })
  const filtered = Boolean(search || category || status)

  function changeFilter(key: string, value: string) {
    const next = new URLSearchParams(filters)
    next.delete('offset')
    if (value) next.set(key, value)
    else next.delete(key)
    setFilters(next, { replace: true })
  }

  return <>
    <PageHeading title="База знаний" subtitle="Статьи для консультаций Voice AI" actions={
      <Button asChild variant="primary"><Link to={{ pathname: path + '/new', search: filters.toString() }}><Plus size={17} /> Создать статью</Link></Button>
    } />
    <section className="panel knowledge-list" aria-label="Статьи базы знаний" aria-busy={query.isFetching}>
      <div className="knowledge-filters">
        <label className="filter-label">Поиск по статьям
          <input className="field" type="search" placeholder="Название или текст статьи" maxLength={200}
            value={search} onChange={event => changeFilter('q', event.target.value)} />
        </label>
        <label className="filter-label">Категория
          <select className="field" value={category} onChange={event => changeFilter('category', event.target.value)}>
            <option value="">Все категории</option>
            {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="filter-label">Статус
          <select className="field" value={status} onChange={event => changeFilter('status', event.target.value)}>
            <option value="">Все статусы</option>
            {Object.entries(statuses).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
          </select>
        </label>
        {filtered && <Button variant="ghost" onClick={() => setFilters({}, { replace: true })}>Сбросить</Button>}
      </div>
      {query.isPending || query.isError || !query.data.items.length ?
        <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()}
          empty={offset ? 'На этой странице нет статей' : filtered ? 'Статьи не найдены' : 'Статей пока нет'} /> :
        <div className="table-scroll" role="region" aria-label="Таблица статей" tabIndex={0}>
          <table className="data-table knowledge-table">
            <thead><tr><th scope="col">Статья</th><th scope="col">Категория</th><th scope="col">Статус</th><th scope="col">Обновлена</th></tr></thead>
            <tbody>{query.data.items.map(article => <tr key={article.id}>
              <td><Link className="table-primary" to={{ pathname: path + '/' + article.id, search: filters.toString() }}>{article.title}</Link></td>
              <td>{categories[article.category]}</td>
              <td><ArticleBadge status={article.status} />{article.has_unpublished_changes && <span className="table-secondary">Есть неопубликованные правки</span>}</td>
              <td className="numeric">{formatDate(article.updated_at)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      {query.data && offset < query.data.total && query.data.total > limit && <Pagination
        total={query.data.total} limit={limit} offset={offset} setOffset={next => {
          const updated = new URLSearchParams(filters)
          updated.set('offset', String(next))
          setFilters(updated)
        }} />}
      {offset > 0 && query.data?.items.length === 0 && <div className="knowledge-page-reset">
        <Button onClick={() => changeFilter('offset', '')}>К первой странице</Button>
      </div>}
    </section>
  </>
}

export function KnowledgeArticle() {
  const { articleId } = useParams()
  const [filters] = useSearchParams()
  const query = useQuery({
    queryKey: ['knowledge', 'article', articleId],
    queryFn: ({ signal }) => api<Article>(endpoint + '/' + encodeURIComponent(articleId!), { signal }),
    enabled: Boolean(articleId),
  })
  return <>
    <PageHeading title={articleId ? 'Статья базы знаний' : 'Новая статья'} />
    <div className="knowledge-editor">
      <Link className="text-link knowledge-back" to={{ pathname: path, search: filters.toString() }}><ArrowLeft size={17} /> К списку статей</Link>
      {articleId && !query.data ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} /> :
        <ArticleForm key={articleId ?? 'new'} article={query.data} />}
    </div>
  </>
}

function ArticleForm({ article }: { article?: Article }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [filters] = useSearchParams()
  const [savedArticle, setSavedArticle] = useState(article)
  const [content, setContent] = useState<ArticleInput>({ title: article?.title ?? '', body: article?.body ?? '', category: article?.category ?? 'company' })
  const [feedback, setFeedback] = useState('')
  const input = { ...content, title: content.title.trim(), body: content.body.trim() }
  const dirty = input.title !== savedArticle?.title || input.body !== savedArticle?.body || input.category !== savedArticle?.category
  const canPublish = Boolean(savedArticle && (savedArticle.status !== 'published' || savedArticle.has_unpublished_changes))
  const mutation = useMutation({
    mutationFn: (action: 'save' | 'publish' | 'archive') => {
      const url = savedArticle ? endpoint + '/' + savedArticle.id : endpoint
      if (action === 'save') {
        return api<Article>(url, { method: savedArticle ? 'PUT' : 'POST', body: JSON.stringify({ ...input, version: savedArticle?.version }) })
      }
      return api<Article>(url + '/' + action, { method: 'POST', body: JSON.stringify({ version: savedArticle?.version }) })
    },
    onMutate: () => setFeedback(''),
    onSuccess: (updated, action) => {
      client.setQueryData(['knowledge', 'article', updated.id], updated)
      void client.invalidateQueries({ queryKey: listKey })
      setSavedArticle(updated)
      setContent({ title: updated.title, body: updated.body, category: updated.category })
      setFeedback({ save: 'Изменения сохранены', publish: 'Статья опубликована', archive: 'Статья в архиве' }[action])
      if (!article) navigate({ pathname: path + '/' + updated.id, search: filters.toString() }, { replace: true })
    },
  })

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutation.isPending && input.title && input.body && dirty) mutation.mutate('save')
  }

  return <form className="panel knowledge-form" onSubmit={save}>
    <header className="panel-heading knowledge-form-heading">
      <div><h2>{savedArticle ? 'Редактирование статьи' : 'Черновик статьи'}</h2>
        {savedArticle?.status === 'published' && <p>Опубликована {formatDate(savedArticle.published_at)}</p>}
      </div>
      {savedArticle && <ArticleBadge status={savedArticle.status} />}
    </header>
    <fieldset className="knowledge-fields" disabled={mutation.isPending}>
      <label className="filter-label">Название
        <input className="field" value={content.title} required maxLength={160} onChange={event => setContent({ ...content, title: event.target.value })} />
      </label>
      <label className="filter-label">Категория
        <select className="field" value={content.category} onChange={event => setContent({ ...content, category: event.target.value as Category })}>
          {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="filter-label">Текст статьи
        <textarea className="field" value={content.body} required rows={10} maxLength={20000}
          onChange={event => setContent({ ...content, body: event.target.value })} />
      </label>
      {savedArticle?.has_unpublished_changes && <p className="knowledge-hint">У статьи есть неопубликованные правки. Voice AI использует последнюю опубликованную версию.</p>}
      {savedArticle && dirty && <p className="knowledge-hint">Сохраните изменения перед публикацией или архивированием.</p>}
      {mutation.isError && <p className="alert" role="alert">{mutation.error.message}</p>}
      {feedback && <p className="knowledge-feedback" role="status">{feedback}</p>}
      <div className="actions knowledge-actions">
        <Button type="submit" variant="primary" disabled={!input.title || !input.body || !dirty}>{savedArticle ? 'Сохранить изменения' : 'Сохранить черновик'}</Button>
        {canPublish && <Button disabled={dirty} onClick={() => mutation.mutate('publish')}>Опубликовать</Button>}
        {savedArticle && savedArticle.status !== 'archived' && <Button disabled={dirty} onClick={() => {
          if (window.confirm('Архивировать статью? Она станет недоступна Voice AI.')) mutation.mutate('archive')
        }}>Архивировать</Button>}
      </div>
    </fieldset>
  </form>
}
