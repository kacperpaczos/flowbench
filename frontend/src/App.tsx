import { useCallback, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { EditorPanel } from './components/EditorPanel'
import { ChatPanel } from './components/ChatPanel'

export function App() {
  const [section, setSection] = useState('procesy')
  // Gdy model utworzy workflow przez MCP, iframe przeskakuje na ten workflow.
  const [workflowId, setWorkflowId] = useState<string | null>(null)

  const openWorkflow = useCallback((id: string) => setWorkflowId(id), [])

  return (
    <div className="app">
      <Sidebar active={section} onSelect={setSection} />
      <EditorPanel workflowId={workflowId} />
      <ChatPanel onWorkflow={openWorkflow} workflowId={workflowId} />
    </div>
  )
}
