import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '../components'

export function NotFound() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  return (
    <main className="lt-main">
      <div className="lt-page">
        <EmptyState
          title={t('notFound.title')}
          description={t('notFound.description')}
          action={
            <Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>
              {t('notFound.toDashboard')}
            </Button>
          }
        />
      </div>
    </main>
  )
}
