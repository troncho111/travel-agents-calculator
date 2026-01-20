import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// ============================================
// API Routes
// ============================================

// Get all agents
app.get('/api/agents', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM agents ORDER BY id').all()
  return c.json(results)
})

// Get agent pricings
app.get('/api/pricings/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM pricings WHERE agent_id = ? ORDER BY created_at DESC'
  ).bind(agentId).all()
  
  // Parse items JSON
  const pricings = results.map((p: any) => ({
    ...p,
    items: JSON.parse(p.items)
  }))
  
  return c.json(pricings)
})

// Save pricing
app.post('/api/pricings', async (c) => {
  const data = await c.req.json()
  
  const result = await c.env.DB.prepare(`
    INSERT INTO pricings (agent_id, title, currency, items, total_cost, markup_percentage, final_price, installments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.agent_id,
    data.title,
    data.currency,
    JSON.stringify(data.items),
    data.total_cost,
    data.markup_percentage,
    data.final_price,
    data.installments
  ).run()
  
  return c.json({ id: result.meta.last_row_id, success: true })
})

// Exchange rates
app.get('/api/exchange-rates/:base', async (c) => {
  const base = c.req.param('base')
  
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`)
    const data = await response.json()
    return c.json({ base, rates: data.rates, updated_at: new Date().toISOString() })
  } catch (error) {
    return c.json({ error: 'Failed to fetch rates' }, 500)
  }
})

// Bank of Israel rate
app.get('/api/boi-rate/:base', async (c) => {
  const base = c.req.param('base')
  
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`)
    const data = await response.json()
    const ilsRate = data.rates.ILS
    const finalRate = ilsRate + 0.04
    
    return c.json({
      currency: base,
      boi_rate: ilsRate,
      markup: 0.04,
      final_rate: finalRate,
      date: new Date().toISOString().split('T')[0]
    })
  } catch (error) {
    return c.json({ error: 'Failed to fetch BOI rate' }, 500)
  }
})

// ============================================
// HTML Pages
// ============================================

// Home page
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>מחשבון סוכנים</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen p-4">
      <div class="max-w-6xl mx-auto">
        <h1 class="text-4xl font-bold text-center text-blue-900 mb-8 mt-8">
          <i class="fas fa-calculator ml-2"></i>
          מחשבון סוכני נסיעות
        </h1>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6" id="agentsGrid">
          <div class="text-center text-gray-500">טוען...</div>
        </div>
      </div>
      
      <script>
        async function loadAgents() {
          const response = await fetch('/api/agents');
          const agents = await response.json();
          
          const grid = document.getElementById('agentsGrid');
          grid.innerHTML = agents.map(agent => \`
            <a href="/agent/\${agent.name}" 
               class="block bg-white rounded-xl shadow-lg p-6 hover:shadow-2xl transition-all transform hover:scale-105">
              <div class="text-center">
                <i class="fas fa-user-circle text-6xl text-blue-500 mb-4"></i>
                <h2 class="text-2xl font-bold text-gray-800">\${agent.name}</h2>
              </div>
            </a>
          \`).join('');
        }
        
        loadAgents();
      </script>
    </body>
    </html>
  `)
})

// Agent page
app.get('/agent/:name', (c) => {
  const agentName = c.req.param('name')
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${agentName} - מחשבון</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    </head>
    <body class="bg-gray-100">
      <div class="max-w-6xl mx-auto p-4">
        <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 class="text-3xl font-bold text-blue-900 mb-4">
            <i class="fas fa-user ml-2"></i>
            ${agentName}
          </h1>
          
          <button onclick="openCalculator()" 
                  class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-lg text-xl">
            <i class="fas fa-calculator ml-2"></i>
            מחשבון תמחור חדש
          </button>
        </div>
        
        <div id="calculator" class="hidden bg-white rounded-lg shadow-lg p-6">
          <h2 class="text-2xl font-bold mb-4">מחשבון תמחור</h2>
          
          <!-- Calculator will be loaded here -->
          <div id="calcContent"></div>
        </div>
      </div>
      
      <script src="/static/calculator.js"></script>
      <script>
        const AGENT_NAME = '${agentName}';
        let AGENT_ID = null;
        
        async function init() {
          const response = await axios.get('/api/agents');
          const agents = response.data;
          const agent = agents.find(a => a.name === AGENT_NAME);
          AGENT_ID = agent.id;
        }
        
        function openCalculator() {
          document.getElementById('calculator').classList.remove('hidden');
          loadCalculatorForm();
        }
        
        init();
      </script>
    </body>
    </html>
  `)
})

export default app
