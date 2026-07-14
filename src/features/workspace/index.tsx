/**
 * "Annotator workspace" feature — routes /label (hub) and
 * /label/task (workspace). Both entry points map to this default
 * component; branching is by the current path.
 */
import { useLocation } from 'react-router-dom'
import { Hub } from './Hub'
import { TaskWorkspace } from './TaskWorkspace'
import './i18n'
import './workspace.css'

export default function Workspace() {
  const { pathname } = useLocation()
  const isTask = pathname.replace(/\/+$/, '').endsWith('/task')
  return isTask ? <TaskWorkspace /> : <Hub />
}
