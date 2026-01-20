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

// Get ALL pricings (shared)
app.get('/api/pricings', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.*, a.name as agent_name 
    FROM pricings p 
    JOIN agents a ON p.agent_id = a.id 
    ORDER BY p.created_at DESC
  `).all()
  
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

// Update pricing
app.put('/api/pricings/:id', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()
  
  await c.env.DB.prepare(`
    UPDATE pricings 
    SET title = ?, currency = ?, items = ?, total_cost = ?, markup_percentage = ?, final_price = ?, installments = ?
    WHERE id = ?
  `).bind(
    data.title,
    data.currency,
    JSON.stringify(data.items),
    data.total_cost,
    data.markup_percentage,
    data.final_price,
    data.installments,
    id
  ).run()
  
  return c.json({ success: true })
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

// Save deal
app.post('/api/deals', async (c) => {
  const data = await c.req.json()
  
  const result = await c.env.DB.prepare(`
    INSERT INTO deals (agent_id, sale_amount, sale_currency, profit_amount, profit_currency, deal_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    data.agent_id,
    data.sale_amount,
    data.sale_currency,
    data.profit_amount,
    data.profit_currency,
    data.deal_date
  ).run()
  
  return c.json({ id: result.meta.last_row_id, success: true })
})

// Get agent deals
app.get('/api/deals/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM deals WHERE agent_id = ? ORDER BY deal_date DESC
  `).bind(agentId).all()
  
  return c.json(results)
})

// Update deal
app.put('/api/deals/:id', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()
  
  await c.env.DB.prepare(`
    UPDATE deals 
    SET sale_amount = ?, sale_currency = ?, profit_amount = ?, profit_currency = ?, deal_date = ?
    WHERE id = ?
  `).bind(
    data.sale_amount,
    data.sale_currency,
    data.profit_amount,
    data.profit_currency,
    data.deal_date,
    id
  ).run()
  
  return c.json({ success: true })
})

// Delete deal
app.delete('/api/deals/:id', async (c) => {
  const id = c.req.param('id')
  
  await c.env.DB.prepare(`
    DELETE FROM deals WHERE id = ?
  `).bind(id).run()
  
  return c.json({ success: true })
})

// Get leaderboard
app.get('/api/leaderboard/:period', async (c) => {
  const period = c.req.param('period') // 'day', 'week', 'month'
  
  let dateFilter = ''
  if (period === 'day') {
    dateFilter = "AND date(d.deal_date) = date('now')"
  } else if (period === 'week') {
    dateFilter = "AND date(d.deal_date) >= date('now', '-7 days')"
  } else if (period === 'month') {
    dateFilter = "AND date(d.deal_date) >= date('now', '-30 days')"
  }
  
  const { results } = await c.env.DB.prepare(`
    SELECT 
      a.id,
      a.name,
      COALESCE(SUM(d.sale_amount), 0) as total_sales,
      COALESCE(SUM(d.profit_amount), 0) as total_profit,
      COUNT(d.id) as deal_count
    FROM agents a
    LEFT JOIN deals d ON a.id = d.agent_id ${dateFilter}
    GROUP BY a.id, a.name
    ORDER BY total_sales DESC
  `).all()
  
  return c.json(results)
})

// Duplicate pricing
app.post('/api/pricings/:id/duplicate', async (c) => {
  const id = c.req.param('id')
  const { agent_id } = await c.req.json()
  
  // Get original pricing
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM pricings WHERE id = ?
  `).bind(id).all()
  
  if (results.length === 0) {
    return c.json({ success: false, error: 'Pricing not found' }, 404)
  }
  
  const original = results[0] as any
  
  // Create duplicate
  const result = await c.env.DB.prepare(`
    INSERT INTO pricings (agent_id, title, currency, items, total_cost, markup_percentage, final_price, installments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    agent_id, // New agent ID
    original.title + ' (עותק)',
    original.currency,
    original.items,
    original.total_cost,
    original.markup_percentage,
    original.final_price,
    original.installments
  ).run()
  
  return c.json({ id: result.meta.last_row_id, success: true })
})

// Delete pricing
app.delete('/api/pricings/:id', async (c) => {
  const id = c.req.param('id')
  
  await c.env.DB.prepare(`
    DELETE FROM pricings WHERE id = ?
  `).bind(id).run()
  
  return c.json({ success: true })
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
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen p-2 md:p-4">
      <div class="max-w-6xl mx-auto">
        <h1 class="text-3xl md:text-4xl font-bold text-center text-blue-900 mb-4 md:mb-8 mt-4 md:mt-8">
          <i class="fas fa-calculator ml-2"></i>
          מחשבון סוכני נסיעות
        </h1>
        
        <!-- Navigation -->
        <div class="flex flex-wrap gap-2 md:gap-4 justify-center mb-6 md:mb-8">
          <a href="/pricings" class="bg-white hover:bg-blue-50 px-4 md:px-6 py-2 md:py-3 rounded-lg shadow font-bold text-sm md:text-base">
            <i class="fas fa-list ml-1 md:ml-2"></i>
            כל התמחורים
          </a>
          <a href="/leaderboard" class="bg-white hover:bg-yellow-50 px-4 md:px-6 py-2 md:py-3 rounded-lg shadow font-bold text-sm md:text-base">
            <i class="fas fa-trophy ml-1 md:ml-2"></i>
            לוח תחרות
          </a>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6" id="agentsGrid">
          <div class="text-center text-gray-500">טוען...</div>
        </div>
      </div>
      
      <script>
        async function loadAgents() {
          const response = await fetch('/api/agents');
          const agents = await response.json();
          
          const grid = document.getElementById('agentsGrid');
          grid.innerHTML = agents.map(agent => 
            '<a href="/agent/' + agent.name + '" ' +
               'class="block bg-white rounded-xl shadow-lg p-4 md:p-6 hover:shadow-2xl transition-all transform hover:scale-105">' +
              '<div class="text-center">' +
                '<i class="fas fa-user-circle text-5xl md:text-6xl text-blue-500 mb-2 md:mb-4"></i>' +
                '<h2 class="text-xl md:text-2xl font-bold text-gray-800">' + agent.name + '</h2>' +
              '</div>' +
            '</a>'
          ).join('');
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
    <body class="bg-gray-100 p-2 md:p-4">
      <div class="max-w-6xl mx-auto">
        <!-- Header -->
        <div class="bg-white rounded-lg shadow-lg p-4 md:p-6 mb-4 md:mb-6">
          <div class="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
            <h1 class="text-2xl md:text-3xl font-bold text-blue-900">
              <i class="fas fa-user ml-2"></i>
              ${agentName}
            </h1>
            <a href="/" class="bg-gray-200 hover:bg-gray-300 px-4 md:px-6 py-2 md:py-3 rounded-lg font-bold text-sm md:text-base">
              <i class="fas fa-home ml-2"></i>
              דף הבית
            </a>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <button onclick="openCalculator()" 
                    class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 md:py-4 rounded-lg text-base md:text-xl">
              <i class="fas fa-calculator ml-2"></i>
              מחשבון תמחור חדש
            </button>
            <button onclick="openDealForm()" 
                    class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 md:py-4 rounded-lg text-base md:text-xl">
              <i class="fas fa-handshake ml-2"></i>
              רשום עסקה
            </button>
            <button onclick="showMyPricings()" 
                    class="bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 md:py-4 rounded-lg text-base md:text-xl">
              <i class="fas fa-folder ml-2"></i>
              התמחורים שלי
            </button>
            <button onclick="showMyDeals()" 
                    class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 md:py-4 rounded-lg text-base md:text-xl">
              <i class="fas fa-chart-line ml-2"></i>
              העסקאות שלי
            </button>
          </div>
        </div>
        
        <!-- Calculator -->
        <div id="calculator" class="hidden bg-white rounded-lg shadow-lg p-4 md:p-6 mb-4 md:mb-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl md:text-2xl font-bold">מחשבון תמחור</h2>
            <button onclick="closeCalculator()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-2xl"></i>
            </button>
          </div>
          
          <!-- Calculator will be loaded here -->
          <div id="calcContent"></div>
        </div>
        
        <!-- Deal Form -->
        <div id="dealForm" class="hidden bg-white rounded-lg shadow-lg p-4 md:p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl md:text-2xl font-bold">רשום עסקה</h2>
            <button onclick="closeDealForm()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-2xl"></i>
            </button>
          </div>
          
          <div class="space-y-4">
            <div>
              <label class="block font-bold mb-2">סכום מכירה:</label>
              <div class="grid grid-cols-2 gap-2">
                <input type="number" id="saleAmount" class="border rounded-lg p-3" placeholder="0.00" step="0.01">
                <select id="saleCurrency" class="border rounded-lg p-3">
                  <option value="EUR">אירו (€)</option>
                  <option value="USD">דולר ($)</option>
                  <option value="GBP">פאונד (£)</option>
                  <option value="ILS">שקל (₪)</option>
                </select>
              </div>
            </div>
            
            <div>
              <label class="block font-bold mb-2">רווח:</label>
              <div class="grid grid-cols-2 gap-2">
                <input type="number" id="profitAmount" class="border rounded-lg p-3" placeholder="0.00" step="0.01">
                <select id="profitCurrency" class="border rounded-lg p-3">
                  <option value="EUR">אירו (€)</option>
                  <option value="USD">דולר ($)</option>
                  <option value="GBP">פאונד (£)</option>
                  <option value="ILS">שקל (₪)</option>
                </select>
              </div>
            </div>
            
            <div>
              <label class="block font-bold mb-2">תאריך העסקה:</label>
              <input type="date" id="dealDate" class="w-full border rounded-lg p-3">
            </div>
            
            <button onclick="saveDeal()" 
                    class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 md:py-4 rounded-lg text-base md:text-xl">
              <i class="fas fa-save ml-2"></i>
              שמור עסקה
            </button>
          </div>
        </div>
        
        <!-- My Pricings -->
        <div id="myPricings" class="hidden bg-white rounded-lg shadow-lg p-4 md:p-6 mb-4 md:mb-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl md:text-2xl font-bold">התמחורים שלי</h2>
            <button onclick="closeMyPricings()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-2xl"></i>
            </button>
          </div>
          
          <div id="myPricingsList" class="space-y-4">
            <div class="text-center text-gray-500">טוען...</div>
          </div>
        </div>
        
        <!-- My Deals -->
        <div id="myDeals" class="hidden bg-white rounded-lg shadow-lg p-4 md:p-6 mb-4 md:mb-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl md:text-2xl font-bold">העסקאות שלי</h2>
            <button onclick="closeMyDeals()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-2xl"></i>
            </button>
          </div>
          
          <div id="myDealsList" class="space-y-4">
            <div class="text-center text-gray-500">טוען...</div>
          </div>
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
          
          // Set today's date
          document.getElementById('dealDate').valueAsDate = new Date();
        }
        
        function openCalculator() {
          document.getElementById('calculator').classList.remove('hidden');
          document.getElementById('dealForm').classList.add('hidden');
          document.getElementById('myPricings').classList.add('hidden');
          document.getElementById('myDeals').classList.add('hidden');
          loadCalculatorForm();
        }
        
        function closeCalculator() {
          document.getElementById('calculator').classList.add('hidden');
        }
        
        function openDealForm() {
          document.getElementById('dealForm').classList.remove('hidden');
          document.getElementById('calculator').classList.add('hidden');
          document.getElementById('myPricings').classList.add('hidden');
          document.getElementById('myDeals').classList.add('hidden');
        }
        
        function closeDealForm() {
          document.getElementById('dealForm').classList.add('hidden');
        }
        
        async function saveDeal() {
          const saleAmount = parseFloat(document.getElementById('saleAmount').value) || 0;
          const profitAmount = parseFloat(document.getElementById('profitAmount').value) || 0;
          const saleCurrency = document.getElementById('saleCurrency').value;
          const profitCurrency = document.getElementById('profitCurrency').value;
          const dealDate = document.getElementById('dealDate').value;
          
          if (saleAmount === 0) {
            alert('אנא הזן סכום מכירה!');
            return;
          }
          
          try {
            await axios.post('/api/deals', {
              agent_id: AGENT_ID,
              sale_amount: saleAmount,
              sale_currency: saleCurrency,
              profit_amount: profitAmount,
              profit_currency: profitCurrency,
              deal_date: dealDate
            });
            
            alert('העסקה נרשמה בהצלחה! ✅');
            closeDealForm();
            
            // Reset form
            document.getElementById('saleAmount').value = '';
            document.getElementById('profitAmount').value = '';
          } catch (error) {
            console.error('Failed to save deal:', error);
            alert('שגיאה ברישום העסקה!');
          }
        }
        
        async function showMyPricings() {
          if (!AGENT_ID) {
            alert('טוען נתוני סוכן...');
            return;
          }
          
          document.getElementById('myPricings').classList.remove('hidden');
          document.getElementById('calculator').classList.add('hidden');
          document.getElementById('dealForm').classList.add('hidden');
          document.getElementById('myDeals').classList.add('hidden');
          
          await loadMyPricings();
        }
        
        function closeMyPricings() {
          document.getElementById('myPricings').classList.add('hidden');
        }
        
        async function loadMyPricings() {
          try {
            const response = await axios.get('/api/pricings/' + AGENT_ID);
            const pricings = response.data;
            
            const container = document.getElementById('myPricingsList');
            if (pricings.length === 0) {
              container.innerHTML = '<div class="text-center text-gray-500 py-8">אין תמחורים עדיין</div>';
              return;
            }
            
            container.innerHTML = pricings.map(pricing => {
              const itemsHTML = pricing.items.map(item => {
                const detailsHTML = item.details ? '<span class="text-gray-600 text-xs md:text-sm block md:inline md:mr-2">(' + item.details + ')</span>' : '';
                return '<div class="flex justify-between text-sm md:text-base">' +
                       '<div>' +
                         '<span class="font-bold">' + item.name + '</span>' +
                         detailsHTML +
                       '</div>' +
                       '<span>' + item.amount + ' ' + item.currency + '</span>' +
                       '</div>';
              }).join('');
              
              return '<div class="bg-gray-50 rounded-lg border-2 p-4 md:p-6">' +
                '<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">' +
                  '<div>' +
                    '<h3 class="text-xl md:text-2xl font-bold text-blue-900">' + pricing.title + '</h3>' +
                    '<p class="text-sm md:text-base text-gray-600">' +
                      '<i class="fas fa-calendar ml-1"></i>' +
                      new Date(pricing.created_at).toLocaleDateString('he-IL') +
                    '</p>' +
                  '</div>' +
                  '<div class="text-left md:text-right">' +
                    '<div class="text-2xl md:text-3xl font-bold text-green-900">' +
                      pricing.final_price.toFixed(2) + ' ' + pricing.currency +
                    '</div>' +
                    '<div class="text-xs md:text-sm text-gray-600">תמחור: ' + pricing.markup_percentage + '%</div>' +
                  '</div>' +
                '</div>' +
                '<div class="border-t pt-4 mb-4">' +
                  '<h4 class="font-bold mb-2 text-sm md:text-base">מרכיבים:</h4>' +
                  '<div class="space-y-2">' +
                    itemsHTML +
                  '</div>' +
                '</div>' +
                '<div class="flex flex-wrap gap-2 pt-4 border-t">' +
                  '<button onclick="editMyPricing(' + pricing.id + ')" ' +
                    'class="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">' +
                    '<i class="fas fa-edit ml-1"></i> ערוך' +
                  '</button>' +
                  '<button onclick="deleteMyPricing(' + pricing.id + ')" ' +
                    'class="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-sm">' +
                    '<i class="fas fa-trash ml-1"></i> מחק' +
                  '</button>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (error) {
            console.error('Failed to load my pricings:', error);
          }
        }
        
        async function deleteMyPricing(pricingId) {
          if (!confirm('בטוח למחוק את התמחור?')) return;
          
          try {
            await axios.delete('/api/pricings/' + pricingId);
            alert('התמחור נמחק בהצלחה!');
            loadMyPricings();
          } catch (error) {
            console.error('Failed to delete pricing:', error);
            alert('שגיאה במחיקה!');
          }
        }
        
        async function editMyPricing(pricingId) {
          try {
            const response = await axios.get('/api/pricings/' + AGENT_ID);
            const pricing = response.data.find(p => p.id === pricingId);
            
            if (!pricing) {
              alert('תמחור לא נמצא!');
              return;
            }
            
            // Close my pricings and open calculator
            closeMyPricings();
            document.getElementById('calculator').classList.remove('hidden');
            
            // Check if calculator form is already loaded
            const calcContent = document.querySelector('#calculator > div.space-y-6');
            if (!calcContent) {
              // Load calculator form if not loaded
              loadCalculatorForm();
            }
            
            // Wait for form to load
            setTimeout(() => {
              // Fill form with existing data
              document.getElementById('title').value = pricing.title;
              document.getElementById('baseCurrency').value = pricing.currency;
              document.getElementById('markup').value = pricing.markup_percentage;
              document.getElementById('installments').value = pricing.installments;
              
              // Load items - update global items variable from calculator.js
              items = pricing.items;
              renderItems();
              recalculate();
              
              // Store pricing ID for update
              window.EDIT_PRICING_ID = pricingId;
              
              // Change save button to update button
              const saveBtn = document.querySelector('#calculator button[onclick="savePricing()"]');
              if (saveBtn) {
                saveBtn.innerHTML = '<i class="fas fa-save ml-2"></i> עדכן תמחור';
                saveBtn.setAttribute('onclick', 'updatePricing()');
              }
            }, 300);
          } catch (error) {
            console.error('Failed to edit pricing:', error);
            alert('שגיאה בטעינת התמחור!');
          }
        }
        
        async function updatePricing() {
          const title = document.getElementById('title').value;
          if (!title) {
            alert('אנא הזן שם לחבילה!');
            return;
          }
          
          const totalCost = parseFloat(document.getElementById('totalCost').textContent) || 0;
          const finalPrice = parseFloat(document.getElementById('finalPrice').textContent) || 0;
          const markup = parseFloat(document.getElementById('markup').value) || 0;
          const installments = parseInt(document.getElementById('installments').value) || 1;
          const currency = document.getElementById('baseCurrency').value;
          
          try {
            await axios.put('/api/pricings/' + window.EDIT_PRICING_ID, {
              title,
              currency,
              items: window.items,
              total_cost: totalCost,
              markup_percentage: markup,
              final_price: finalPrice,
              installments
            });
            
            alert('התמחור עודכן בהצלחה! ✅');
            closeCalculator();
            
            // Reset button
            const saveBtn = document.querySelector('#calculator button[onclick="updatePricing()"]');
            if (saveBtn) {
              saveBtn.innerHTML = '<i class="fas fa-save ml-2"></i> שמור תמחור';
              saveBtn.setAttribute('onclick', 'savePricing()');
            }
            
            // Clear EDIT_PRICING_ID
            delete window.EDIT_PRICING_ID;
          } catch (error) {
            console.error('Failed to update:', error);
            alert('שגיאה בעדכון!');
          }
        }
        
        async function showMyDeals() {
          if (!AGENT_ID) {
            alert('טוען נתוני סוכן...');
            return;
          }
          
          document.getElementById('myDeals').classList.remove('hidden');
          document.getElementById('calculator').classList.add('hidden');
          document.getElementById('dealForm').classList.add('hidden');
          document.getElementById('myPricings').classList.add('hidden');
          
          await loadMyDeals();
        }
        
        function closeMyDeals() {
          document.getElementById('myDeals').classList.add('hidden');
        }
        
        async function loadMyDeals() {
          try {
            const response = await axios.get('/api/deals/' + AGENT_ID);
            const deals = response.data;
            
            const container = document.getElementById('myDealsList');
            if (deals.length === 0) {
              container.innerHTML = '<div class="text-center text-gray-500 py-8">אין עסקאות עדיין</div>';
              return;
            }
            
            container.innerHTML = deals.map(deal => {
              return '<div class="bg-gray-50 rounded-lg border-2 p-4 md:p-6">' +
                '<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">' +
                  '<div class="flex-1">' +
                    '<div class="text-2xl md:text-3xl font-bold text-green-900 mb-2">' +
                      deal.sale_amount.toFixed(2) + ' ' + deal.sale_currency +
                    '</div>' +
                    '<div class="text-lg font-bold text-blue-700">' +
                      'רווח: ' + deal.profit_amount.toFixed(2) + ' ' + deal.profit_currency +
                    '</div>' +
                    '<p class="text-sm md:text-base text-gray-600 mt-2">' +
                      '<i class="fas fa-calendar ml-1"></i>' +
                      new Date(deal.deal_date).toLocaleDateString('he-IL') +
                    '</p>' +
                  '</div>' +
                '</div>' +
                '<div class="flex flex-wrap gap-2 pt-4 border-t">' +
                  '<button onclick="editDeal(' + deal.id + ')" ' +
                    'class="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">' +
                    '<i class="fas fa-edit ml-1"></i> ערוך' +
                  '</button>' +
                  '<button onclick="deleteMyDeal(' + deal.id + ')" ' +
                    'class="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-sm">' +
                    '<i class="fas fa-trash ml-1"></i> מחק' +
                  '</button>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (error) {
            console.error('Failed to load my deals:', error);
          }
        }
        
        async function editDeal(dealId) {
          try {
            const response = await axios.get('/api/deals/' + AGENT_ID);
            const deal = response.data.find(d => d.id === dealId);
            
            if (!deal) {
              alert('עסקה לא נמצאה!');
              return;
            }
            
            // Fill form
            document.getElementById('saleAmount').value = deal.sale_amount;
            document.getElementById('saleCurrency').value = deal.sale_currency;
            document.getElementById('profitAmount').value = deal.profit_amount;
            document.getElementById('profitCurrency').value = deal.profit_currency;
            document.getElementById('dealDate').value = deal.deal_date;
            
            // Store deal ID for update
            window.EDIT_DEAL_ID = dealId;
            
            // Open deal form
            closeMyDeals();
            document.getElementById('dealForm').classList.remove('hidden');
            
            // Change button text
            const saveBtn = document.querySelector('#dealForm button[onclick="saveDeal()"]');
            saveBtn.innerHTML = '<i class="fas fa-save ml-2"></i> עדכן עסקה';
            saveBtn.setAttribute('onclick', 'updateDeal()');
          } catch (error) {
            console.error('Failed to edit deal:', error);
            alert('שגיאה בטעינת העסקה!');
          }
        }
        
        async function updateDeal() {
          const saleAmount = parseFloat(document.getElementById('saleAmount').value) || 0;
          const profitAmount = parseFloat(document.getElementById('profitAmount').value) || 0;
          const saleCurrency = document.getElementById('saleCurrency').value;
          const profitCurrency = document.getElementById('profitCurrency').value;
          const dealDate = document.getElementById('dealDate').value;
          
          if (saleAmount === 0) {
            alert('אנא הזן סכום מכירה!');
            return;
          }
          
          try {
            await axios.put('/api/deals/' + window.EDIT_DEAL_ID, {
              sale_amount: saleAmount,
              sale_currency: saleCurrency,
              profit_amount: profitAmount,
              profit_currency: profitCurrency,
              deal_date: dealDate
            });
            
            alert('העסקה עודכנה בהצלחה! ✅');
            closeDealForm();
            
            // Reset button
            const saveBtn = document.querySelector('#dealForm button[onclick="updateDeal()"]');
            saveBtn.innerHTML = '<i class="fas fa-save ml-2"></i> שמור עסקה';
            saveBtn.setAttribute('onclick', 'saveDeal()');
            
            // Clear EDIT_DEAL_ID
            delete window.EDIT_DEAL_ID;
            
            // Reset form
            document.getElementById('saleAmount').value = '';
            document.getElementById('profitAmount').value = '';
          } catch (error) {
            console.error('Failed to update deal:', error);
            alert('שגיאה בעדכון העסקה!');
          }
        }
        
        async function deleteMyDeal(dealId) {
          if (!confirm('בטוח למחוק את העסקה?')) return;
          
          try {
            await axios.delete('/api/deals/' + dealId);
            alert('העסקה נמחקה בהצלחה!');
            loadMyDeals();
          } catch (error) {
            console.error('Failed to delete deal:', error);
            alert('שגיאה במחיקה!');
          }
        }
        
        init();
      </script>
    </body>
    </html>
  `)
})
// Shared Pricings Page
app.get('/pricings', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>כל התמחורים</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    </head>
    <body class="bg-gray-100 p-2 md:p-4">
      <div class="max-w-6xl mx-auto">
        <div class="bg-white rounded-lg shadow-lg p-4 md:p-6 mb-4 md:mb-6">
          <div class="flex flex-col md:flex-row justify-between items-center gap-4">
            <h1 class="text-2xl md:text-3xl font-bold text-blue-900">
              <i class="fas fa-list ml-2"></i>
              כל התמחורים
            </h1>
            <a href="/" class="bg-blue-500 hover:bg-blue-600 text-white px-4 md:px-6 py-2 md:py-3 rounded-lg font-bold text-sm md:text-base">
              <i class="fas fa-home ml-2"></i>
              חזרה לדף הבית
            </a>
          </div>
        </div>
        
        <div id="pricingsList" class="space-y-4">
          <div class="text-center text-gray-500">טוען...</div>
        </div>
      </div>
      
      <script>
        async function loadPricings() {
          try {
            const response = await axios.get('/api/pricings');
            const pricings = response.data;
            
            const container = document.getElementById('pricingsList');
            if (pricings.length === 0) {
              container.innerHTML = '<div class="text-center text-gray-500 py-8">אין תמחורים עדיין</div>';
              return;
            }
            
            container.innerHTML = pricings.map(pricing => {
              const itemsHTML = pricing.items.map(item => {
                const detailsHTML = item.details ? '<span class="text-gray-600 text-xs md:text-sm block md:inline md:mr-2">(' + item.details + ')</span>' : '';
                return '<div class="flex justify-between text-sm md:text-base">' +
                       '<div>' +
                         '<span class="font-bold">' + item.name + '</span>' +
                         detailsHTML +
                       '</div>' +
                       '<span>' + item.amount + ' ' + item.currency + '</span>' +
                       '</div>';
              }).join('');
              
              return '<div class="bg-white rounded-lg shadow-lg p-4 md:p-6">' +
                '<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">' +
                  '<div>' +
                    '<h3 class="text-xl md:text-2xl font-bold text-blue-900">' + pricing.title + '</h3>' +
                    '<p class="text-sm md:text-base text-gray-600">' +
                      '<i class="fas fa-user ml-1"></i>' +
                      pricing.agent_name + ' • ' +
                      new Date(pricing.created_at).toLocaleDateString('he-IL') +
                    '</p>' +
                  '</div>' +
                  '<div class="text-left md:text-right">' +
                    '<div class="text-2xl md:text-3xl font-bold text-green-900">' +
                      pricing.final_price.toFixed(2) + ' ' + pricing.currency +
                    '</div>' +
                    '<div class="text-xs md:text-sm text-gray-600">תמחור: ' + pricing.markup_percentage + '%</div>' +
                  '</div>' +
                '</div>' +
                '<div class="border-t pt-4 mb-4">' +
                  '<h4 class="font-bold mb-2 text-sm md:text-base">מרכיבים:</h4>' +
                  '<div class="space-y-2">' +
                    itemsHTML +
                  '</div>' +
                '</div>' +
                '<div class="flex flex-wrap gap-2 pt-4 border-t">' +
                  '<button onclick="duplicatePricing(' + pricing.id + ')" ' +
                    'class="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm">' +
                    '<i class="fas fa-copy ml-1"></i> שכפל' +
                  '</button>' +
                  '<button onclick="deletePricing(' + pricing.id + ')" ' +
                    'class="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-sm">' +
                    '<i class="fas fa-trash ml-1"></i> מחק' +
                  '</button>' +
                '</div>' +
              '</div>';
            }).join('');
          } catch (error) {
            console.error('Failed to load pricings:', error);
          }
        }
        
        async function duplicatePricing(pricingId) {
          const agentName = prompt('לאיזה סוכן לשכפל? הזן שם:');
          if (!agentName) return;
          
          try {
            // Get agent ID
            const agentsResponse = await axios.get('/api/agents');
            const agent = agentsResponse.data.find(a => a.name === agentName);
            
            if (!agent) {
              alert('סוכן לא נמצא!');
              return;
            }
            
            // Duplicate pricing
            await axios.post('/api/pricings/' + pricingId + '/duplicate', {
              agent_id: agent.id
            });
            
            alert('התמחור שוכפל בהצלחה!');
            loadPricings();
          } catch (error) {
            console.error('Failed to duplicate pricing:', error);
            alert('שגיאה בשכפול!');
          }
        }
        
        async function deletePricing(pricingId) {
          if (!confirm('בטוח למחוק את התמחור?')) return;
          
          try {
            await axios.delete('/api/pricings/' + pricingId);
            alert('התמחור נמחק בהצלחה!');
            loadPricings();
          } catch (error) {
            console.error('Failed to delete pricing:', error);
            alert('שגיאה במחיקה!');
          }
        }
        
        loadPricings();
      </script>
    </body>
    </html>
  `)
})

// Leaderboard Page
app.get('/leaderboard', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>לוח תחרות</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    </head>
    <body class="bg-gray-100 p-2 md:p-4">
      <div class="max-w-6xl mx-auto">
        <div class="bg-white rounded-lg shadow-lg p-4 md:p-6 mb-4 md:mb-6">
          <div class="flex flex-col md:flex-row justify-between items-center gap-4">
            <h1 class="text-2xl md:text-3xl font-bold text-yellow-600">
              <i class="fas fa-trophy ml-2"></i>
              לוח תחרות
            </h1>
            <a href="/" class="bg-blue-500 hover:bg-blue-600 text-white px-4 md:px-6 py-2 md:py-3 rounded-lg font-bold text-sm md:text-base">
              <i class="fas fa-home ml-2"></i>
              חזרה לדף הבית
            </a>
          </div>
        </div>
        
        <!-- Tabs -->
        <div class="flex flex-wrap gap-2 md:gap-4 mb-4 md:mb-6">
          <button onclick="loadLeaderboard('day')" id="btn-day" 
                  class="flex-1 md:flex-initial bg-white hover:bg-yellow-50 px-4 md:px-6 py-2 md:py-3 rounded-lg shadow font-bold text-sm md:text-base">
            <i class="fas fa-calendar-day ml-1 md:ml-2"></i>
            היום
          </button>
          <button onclick="loadLeaderboard('week')" id="btn-week"
                  class="flex-1 md:flex-initial bg-white hover:bg-yellow-50 px-4 md:px-6 py-2 md:py-3 rounded-lg shadow font-bold text-sm md:text-base">
            <i class="fas fa-calendar-week ml-1 md:ml-2"></i>
            השבוע
          </button>
          <button onclick="loadLeaderboard('month')" id="btn-month"
                  class="flex-1 md:flex-initial bg-white hover:bg-yellow-50 px-4 md:px-6 py-2 md:py-3 rounded-lg shadow font-bold text-sm md:text-base">
            <i class="fas fa-calendar-alt ml-1 md:ml-2"></i>
            החודש
          </button>
        </div>
        
        <div id="leaderboard" class="space-y-4">
          <div class="text-center text-gray-500">טוען...</div>
        </div>
      </div>
      
      <script>
        let currentPeriod = 'day';
        
        async function loadLeaderboard(period) {
          currentPeriod = period;
          
          // Update tabs
          ['day', 'week', 'month'].forEach(p => {
            const btn = document.getElementById(\`btn-\${p}\`);
            if (p === period) {
              btn.classList.add('bg-yellow-100', 'border-2', 'border-yellow-400');
              btn.classList.remove('bg-white');
            } else {
              btn.classList.remove('bg-yellow-100', 'border-2', 'border-yellow-400');
              btn.classList.add('bg-white');
            }
          });
          
          try {
            const response = await axios.get(\`/api/leaderboard/\${period}\`);
            const data = response.data;
            
            const container = document.getElementById('leaderboard');
            if (data.length === 0 || data.every(a => a.deal_count === 0)) {
              container.innerHTML = '<div class="text-center text-gray-500 py-8">אין עסקאות עדיין</div>';
              return;
            }
            
            container.innerHTML = data.map((agent, index) => {
              let medal = '';
              if (index === 0) medal = '<i class="fas fa-medal text-yellow-500 text-2xl md:text-4xl"></i>';
              else if (index === 1) medal = '<i class="fas fa-medal text-gray-400 text-xl md:text-3xl"></i>';
              else if (index === 2) medal = '<i class="fas fa-medal text-orange-600 text-lg md:text-2xl"></i>';
              
              const bgColor = index === 0 ? 'bg-gradient-to-r from-yellow-50 to-yellow-100 border-2 border-yellow-400' : 
                              index === 1 ? 'bg-gradient-to-r from-gray-50 to-gray-100' :
                              index === 2 ? 'bg-gradient-to-r from-orange-50 to-orange-100' : 'bg-white';
              
              return \`
                <div class="\${bgColor} rounded-lg shadow-lg p-4 md:p-6">
                  <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-4">
                      <div class="text-center min-w-[40px] md:min-w-[60px]">
                        \${medal || \`<div class="text-xl md:text-3xl font-bold text-gray-400">#\${index + 1}</div>\`}
                      </div>
                      <div>
                        <h3 class="text-xl md:text-2xl font-bold text-gray-800">\${agent.name}</h3>
                        <p class="text-xs md:text-sm text-gray-600">\${agent.deal_count} עסקאות</p>
                      </div>
                    </div>
                    <div class="text-left md:text-right">
                      <div class="text-xl md:text-3xl font-bold text-green-900">₪\${agent.total_sales.toFixed(0)}</div>
                      <div class="text-xs md:text-sm text-gray-600">רווח: ₪\${agent.total_profit.toFixed(0)}</div>
                    </div>
                  </div>
                </div>
              \`;
            }).join('');
          } catch (error) {
            console.error('Failed to load leaderboard:', error);
          }
        }
        
        loadLeaderboard('day');
      </script>
    </body>
    </html>
  `)
})

export default app
