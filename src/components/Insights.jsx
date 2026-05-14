import { useState, useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { startOfDay, startOfWeek, startOfMonth } from '../lib/dates'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
)

const CHART_OPTS = {
  responsive: true,
  plugins: { legend: { display: false }, tooltip: { mode: 'index' } },
  scales: {
    x: { grid: { display: false } },
    y: { grid: { color: '#f0ede8' }, ticks: { stepSize: 1 } },
  },
}

export default function Insights({ tasks }) {
  const [range, setRange] = useState('week')

  const completed = tasks.filter(t => t.completed && t.completed_at)

  const barData = useMemo(() => {
    const now = new Date()
    let labels = [], buckets = []

    if (range === 'day') {
      labels = Array.from({ length: 24 }, (_, i) => `${i}h`)
      buckets = Array(24).fill(0)
      completed.forEach(t => {
        const d = new Date(t.completed_at)
        if (d.toDateString() === now.toDateString()) buckets[d.getHours()]++
      })
    } else if (range === 'week') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      labels = days
      buckets = Array(7).fill(0)
      const weekStart = startOfWeek()
      completed.forEach(t => {
        const d = new Date(t.completed_at)
        if (d >= weekStart) buckets[d.getDay()]++
      })
    } else {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`)
      buckets = Array(daysInMonth).fill(0)
      const monthStart = startOfMonth()
      completed.forEach(t => {
        const d = new Date(t.completed_at)
        if (d >= monthStart) buckets[d.getDate() - 1]++
      })
    }

    return {
      labels,
      datasets: [{
        label: 'Completed',
        data: buckets,
        backgroundColor: 'rgba(37,99,235,.75)',
        borderRadius: 5,
        borderSkipped: false,
      }],
    }
  }, [completed, range])

  const lineData = useMemo(() => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const buckets = Array(12).fill(0)
    completed.forEach(t => {
      buckets[new Date(t.completed_at).getMonth()]++
    })
    return {
      labels: months,
      datasets: [{
        label: 'Completed / month',
        data: buckets,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,.08)',
        fill: true,
        tension: .4,
        pointBackgroundColor: '#2563eb',
      }],
    }
  }, [completed])

  const total     = tasks.length
  const done      = tasks.filter(t => t.completed).length
  const pending   = total - done
  const overdue   = tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date()).length

  return (
    <div>
      <div className="insights-grid">
        {[
          { label: 'Total Tasks',  value: total },
          { label: 'Completed',    value: done  },
          { label: 'Pending',      value: pending },
          { label: 'Overdue',      value: overdue },
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <div className="chart-title">Completed tasks</div>
          <div className="toggle-group">
            {['day', 'week', 'month'].map(r => (
              <button
                key={r}
                className={`toggle-btn ${range === r ? 'active' : ''}`}
                onClick={() => setRange(r)}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <Bar data={barData} options={CHART_OPTS} />
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <div className="chart-title">Monthly trend</div>
        </div>
        <Line data={lineData} options={CHART_OPTS} />
      </div>
    </div>
  )
}
