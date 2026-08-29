import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import Triage from './pages/Triage'
import History from './pages/History'
import NewComplaint from './pages/NewComplaint'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/triage" element={<Triage />} />
        <Route path="/history" element={<History />} />
        <Route path="/new" element={<NewComplaint />} />
      </Routes>
    </Layout>
  )
}
