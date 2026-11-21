import { Landing } from './components/landing'
import CygnusLanding from './components/landingmain'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CygnusLanding />} />
        <Route path="/deploy" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App