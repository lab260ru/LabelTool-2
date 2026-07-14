import { useParams } from 'react-router-dom'
import './i18n'
import './projects.css'
import { ProjectDetail } from './ProjectDetail'
import ProjectsList from './ProjectsList'

/**
 * "Projects" feature. A single default component serves both
 * contract routes: /admin/projects (list) and /admin/projects/:id (project).
 */
export default function ProjectsFeature() {
  const { id } = useParams()
  return id !== undefined ? <ProjectDetail projectId={Number(id)} /> : <ProjectsList />
}
