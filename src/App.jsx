import { Routes, Route } from 'react-router-dom'
import Gate from './components/Gate'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import Triage from './pages/Triage'
import Floor from './pages/Floor'
import History from './pages/History'
import MasterData from './pages/MasterData'
import Complaints from './pages/Complaints'

export default function App() {
  return (
    <Gate>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/floor" element={<Floor />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/triage" element={<Triage />} />
          <Route path="/complaints" element={<Complaints />} />
          <Route path="/history" element={<History />} />
          <Route path="/master" element={<MasterData />} />
        </Routes>
      </Layout>
    </Gate>
  )
}
