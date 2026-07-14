import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../EmptyState/EmptyState'
import { Spinner } from '../Spinner/Spinner'
import { IconChevronDown, IconSearch } from '../icons'
import './datatable.css'

/**
 * Generic data table: sorting, filter (search), pagination,
 * empty state. Desktop-first; for 100k+ rows, features use
 * server-side pagination — the component receives an already-loaded page.
 */
export interface DataTableColumn<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  /** Value used for sorting (defaults to row[key]). */
  sortValue?: (row: T) => string | number
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  width?: string
  /** Tabular figures (file names, timecodes, sizes). */
  numeric?: boolean
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  /** Search box above the table. */
  filterable?: boolean
  filterPlaceholder?: string
  /** Custom filter predicate; defaults to substring matching over row values. */
  filterFn?: (row: T, query: string) => boolean
  /** Page size; if unset — no pagination. */
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  loading?: boolean
  onRowClick?: (row: T) => void
  className?: string
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null

function defaultFilter<T>(row: T, query: string): boolean {
  return Object.values(row as Record<string, unknown>)
    .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : ''))
    .join(' ')
    .toLowerCase()
    .includes(query)
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  filterable = false,
  filterPlaceholder,
  filterFn = defaultFilter,
  pageSize,
  emptyTitle,
  emptyDescription,
  loading = false,
  onRowClick,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => filterFn(row, q))
  }, [rows, query, filterFn])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return filtered
    const getValue = col.sortValue ?? ((row: T) => {
      const v = (row as Record<string, unknown>)[col.key]
      return typeof v === 'number' ? v : String(v ?? '')
    })
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = getValue(a)
      const vb = getValue(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor
    })
  }, [filtered, sort, columns])

  const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = pageSize ? sorted.slice(safePage * pageSize, (safePage + 1) * pageSize) : sorted

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortable) return
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' }
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' }
      return null
    })
  }

  function changeQuery(value: string) {
    setQuery(value)
    setPage(0)
  }

  const cls = ['lt-table', className ?? ''].filter(Boolean).join(' ')
  const isEmpty = !loading && pageRows.length === 0
  const emptyIsFromFilter = isEmpty && rows.length > 0 && query.trim() !== ''

  return (
    <div className={cls}>
      {filterable && (
        <div className="lt-table__toolbar">
          <span className="lt-table__search">
            <IconSearch size={16} className="lt-table__search-icon" />
            <input
              className="lt-table__search-input"
              type="search"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder={filterPlaceholder ?? t('table.filter')}
              aria-label={t('actions.search')}
            />
          </span>
        </div>
      )}

      <div className="lt-table__scroll">
        <table className="lt-table__table">
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = sort?.key === col.key
                const ariaSort = isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined
                return (
                  <th
                    key={col.key}
                    style={{ width: col.width, textAlign: col.align }}
                    aria-sort={ariaSort}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        className={`lt-table__sort${isSorted ? ' lt-table__sort--active' : ''}`}
                        onClick={() => toggleSort(col)}
                        title={t('table.sort')}
                      >
                        {col.header}
                        <IconChevronDown
                          size={13}
                          className={`lt-table__sort-icon${
                            isSorted && sort!.dir === 'desc' ? '' : ' lt-table__sort-icon--up'
                          }${isSorted ? ' lt-table__sort-icon--visible' : ''}`}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length} className="lt-table__loading">
                  <Spinner size={18} inline /> {t('table.loading')}
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={onRowClick ? 'lt-table__row--clickable' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{ textAlign: col.align }}
                      className={col.numeric ? 'lt-data' : undefined}
                    >
                      {col.render
                        ? col.render(row)
                        : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>

        {isEmpty && (
          <EmptyState
            compact
            title={emptyIsFromFilter ? t('table.emptyFiltered') : (emptyTitle ?? t('table.empty'))}
            description={emptyIsFromFilter ? t('table.emptyFilteredHint') : emptyDescription}
          />
        )}
      </div>

      {pageSize !== undefined && sorted.length > 0 && (
        <nav className="lt-table__pagination" aria-label={t('table.pagination')}>
          <span className="lt-table__range lt-data">
            {t('table.range', {
              from: safePage * pageSize + 1,
              to: Math.min((safePage + 1) * pageSize, sorted.length),
              total: sorted.length,
            })}
          </span>
          <span className="lt-table__pages">
            <button
              type="button"
              className="lt-table__page-btn"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label={t('table.prevPage')}
            >
              ←
            </button>
            <span className="lt-data">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="lt-table__page-btn"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label={t('table.nextPage')}
            >
              →
            </button>
          </span>
        </nav>
      )}
    </div>
  )
}
