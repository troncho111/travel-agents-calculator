// Calculator JavaScript for Agent Page
// This is loaded inline in the HTML

let exchangeRates = {};
let ilsRate = 3.7162;
let items = [
  { name: 'טיסה', details: '', amount: 0, currency: 'USD' },
  { name: 'מלון', details: '', amount: 0, currency: 'EUR' },
  { name: 'כרטיסים', details: '', amount: 0, currency: 'EUR' }
];

// Load rates immediately
async function loadRates() {
  try {
    const eurResp = await axios.get('/api/exchange-rates/EUR');
    exchangeRates = eurResp.data.rates;
    
    const ilsResp = await axios.get('/api/boi-rate/EUR');
    ilsRate = ilsResp.data.final_rate;
    
    console.log('✅ Rates loaded:', { exchangeRates, ilsRate });
  } catch (error) {
    console.error('Failed to load rates:', error);
  }
}

loadRates();

function loadCalculatorForm() {
  let html = `
    <div class="space-y-6">
      <!-- Title -->
      <div class="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-300 rounded-xl p-6">
        <label class="block text-purple-900 font-bold text-2xl mb-3">
          <i class="fas fa-tag mr-2"></i>
          שם החבילה / התמחור
        </label>
        <input type="text" id="title" 
               class="w-full border-2 border-purple-300 rounded-lg p-4 text-2xl font-bold" 
               placeholder="למשל: ריאל מדריד - ברצלונה">
        <p class="text-purple-600 text-sm mt-2">זה השם שיופיע בכל התמחורים השמורים</p>
      </div>
      
      <!-- Base Currency -->
      <div>
        <label class="block font-bold mb-2 text-lg">מטבע ראשי:</label>
        <select id="baseCurrency" class="w-full border rounded-lg p-3 text-lg" onchange="recalculate()">
          <option value="EUR">אירו (€)</option>
          <option value="USD">דולר ($)</option>
          <option value="GBP">פאונד (£)</option>
          <option value="ILS">שקל (₪)</option>
        </select>
      </div>
      
      <!-- Items -->
      <div>
        <h3 class="text-xl font-bold mb-4 flex items-center">
          <i class="fas fa-list-ul ml-2"></i>
          מרכיבי העלות:
        </h3>
        <div id="itemsContainer" class="space-y-4"></div>
        <button type="button" onclick="addItem()" 
                class="w-full mt-4 bg-blue-100 hover:bg-blue-200 text-blue-900 font-bold py-3 rounded-lg">
          <i class="fas fa-plus ml-2"></i>
          הוסף מרכיב
        </button>
      </div>
      
      <!-- Total Cost -->
      <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div class="text-lg font-bold mb-2">עלות כוללת:</div>
        <div class="text-3xl font-bold text-blue-900">
          <span id="totalCost">0.00</span> <span id="totalCurrency">EUR</span>
        </div>
      </div>
      
      <!-- Markup -->
      <div>
        <label class="block font-bold mb-2 text-lg">תמחור:</label>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <button type="button" onclick="setMarkup(19)" class="bg-blue-100 hover:bg-blue-200 p-3 rounded-lg font-bold">19%</button>
          <button type="button" onclick="setMarkup(22)" class="bg-green-100 hover:bg-green-200 p-3 rounded-lg font-bold">22%</button>
          <button type="button" onclick="setMarkup(25)" class="bg-yellow-100 hover:bg-yellow-200 p-3 rounded-lg font-bold">25%</button>
          <button type="button" onclick="setMarkup(30)" class="bg-pink-100 hover:bg-pink-200 p-3 rounded-lg font-bold">30%</button>
        </div>
        <input type="number" id="markup" 
               class="w-full border rounded-lg p-3" 
               placeholder="או הקלד אחוז משלך..." step="0.1" oninput="recalculate()">
      </div>
      
      <!-- Final Price -->
      <div class="bg-green-50 border-2 border-green-300 rounded-lg p-6">
        <div class="text-lg font-bold mb-2">רווח:</div>
        <div class="text-2xl font-bold text-green-700 mb-4">
          <span id="profit">0.00</span> <span id="profitCurrency">EUR</span>
        </div>
        
        <div class="text-xl font-bold mb-2">מחיר ללקוח:</div>
        <div class="text-4xl font-bold text-green-900 mb-4">
          <span id="finalPrice">0.00</span> <span id="finalCurrency">EUR</span>
        </div>
        
        <div id="priceILS" class="text-2xl font-bold text-green-800 mt-4 pt-4 border-t-2 border-green-200"></div>
      </div>
      
      <!-- Installments -->
      <div>
        <label class="block font-bold mb-2 text-lg">תשלומים:</label>
        <div class="flex gap-2">
          <input type="number" id="installments" value="1" min="1" max="24"
                 class="flex-1 border rounded-lg p-3">
          <button type="button" onclick="calculateInstallments()" 
                  class="bg-green-500 hover:bg-green-600 text-white font-bold px-6 rounded-lg whitespace-nowrap">
            <i class="fas fa-calculator ml-1"></i>
            חשב תשלומים
          </button>
        </div>
        <div id="interestInfo" class="mt-2 text-gray-600"></div>
        <div id="paymentTable" class="mt-4"></div>
      </div>
      
      <!-- Save Button -->
      <div class="sticky bottom-0 bg-white pt-4 pb-2 border-t">
        <button type="button" onclick="savePricing()" 
                class="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 rounded-lg text-xl hover:shadow-xl">
          <i class="fas fa-save ml-2"></i>
          שמור תמחור
        </button>
      </div>
    </div>
  `;
  
  document.getElementById('calcContent').innerHTML = html;
  renderItems();
  recalculate();
}

function renderItems() {
  const container = document.getElementById('itemsContainer');
  container.innerHTML = items.map((item, index) => {
    // Dynamic placeholder based on item name
    let placeholder = 'פרטים';
    if (item.name.includes('טיסה') || item.name.includes('טיסות')) {
      placeholder = 'למשל: British Airways BA123, 17-24/04';
    } else if (item.name.includes('מלון')) {
      placeholder = 'למשל: שם המלון, צ\'ק-אין 17/04, צ\'ק-אאוט 24/04';
    } else if (item.name.includes('כרטיס')) {
      placeholder = 'למשל: קטגוריה, מגרש/אזור, תאריך';
    }
    
    return `
    <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div class="flex justify-between items-center mb-3">
        <input type="text" value="${item.name}" 
               onchange="items[${index}].name = this.value; renderItems()"
               class="font-bold text-lg border-0 bg-transparent flex-1" 
               placeholder="שם המרכיב">
        <button type="button" onclick="removeItem(${index})" 
                class="text-red-500 hover:text-red-700 px-2">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <textarea onchange="items[${index}].details = this.value" 
                class="w-full border rounded p-2 text-sm mb-2" 
                rows="2" 
                placeholder="${placeholder}">${item.details}</textarea>
      <div class="grid grid-cols-2 gap-2">
        <input type="number" value="${item.amount}" 
               onchange="items[${index}].amount = parseFloat(this.value) || 0; recalculate()"
               class="border rounded p-2" 
               placeholder="סכום" step="0.01">
        <select onchange="items[${index}].currency = this.value; recalculate()"
                class="border rounded p-2">
          <option value="EUR" \${item.currency === 'EUR' ? 'selected' : ''}>אירו (€)</option>
          <option value="USD" \${item.currency === 'USD' ? 'selected' : ''}>דולר ($)</option>
          <option value="GBP" \${item.currency === 'GBP' ? 'selected' : ''}>פאונד (£)</option>
          <option value="ILS" \${item.currency === 'ILS' ? 'selected' : ''}>שקל (₪)</option>
        </select>
      </div>
    </div>
  `;
  }).join('');
}

function addItem() {
  items.push({ name: '', details: '', amount: 0, currency: 'EUR' });
  renderItems();
}

function removeItem(index) {
  if (items.length <= 1) {
    alert('חייב להיות לפחות מרכיב אחד!');
    return;
  }
  items.splice(index, 1);
  renderItems();
  recalculate();
}

function setMarkup(percent) {
  document.getElementById('markup').value = percent;
  recalculate();
}

function recalculate() {
  const baseCurrency = document.getElementById('baseCurrency').value;
  let totalInBase = 0;
  
  // Calculate total in base currency
  items.forEach(item => {
    if (item.currency === baseCurrency) {
      totalInBase += item.amount;
    } else {
      const rate = exchangeRates[item.currency] || 1;
      const baseRate = exchangeRates[baseCurrency] || 1;
      totalInBase += (item.amount / rate) * baseRate;
    }
  });
  
  document.getElementById('totalCost').textContent = totalInBase.toFixed(2);
  document.getElementById('totalCurrency').textContent = baseCurrency;
  
  // Calculate final price with correct markup formula
  // Markup formula: finalPrice = cost / (1 - markup%)
  // This ensures the profit is exactly markup% of the final price
  const markup = parseFloat(document.getElementById('markup').value) || 0;
  const finalPrice = totalInBase / (1 - markup / 100);
  const profit = finalPrice - totalInBase;
  
  document.getElementById('profit').textContent = profit.toFixed(2);
  document.getElementById('profitCurrency').textContent = baseCurrency;
  document.getElementById('finalPrice').textContent = finalPrice.toFixed(2);
  document.getElementById('finalCurrency').textContent = baseCurrency;
  
  // Calculate ILS price based on base currency
  let currentILSRate = ilsRate; // Default EUR rate
  let priceILS = 0;
  
  if (baseCurrency === 'ILS') {
    priceILS = finalPrice;
    currentILSRate = 1;
  } else if (baseCurrency === 'EUR') {
    priceILS = finalPrice * ilsRate;
    currentILSRate = ilsRate;
  } else {
    // For USD, GBP, or other currencies - calculate via exchange rates
    const baseToILS = exchangeRates['ILS'] || 1;
    const eurToBase = exchangeRates[baseCurrency] || 1;
    currentILSRate = baseToILS / eurToBase;
    priceILS = finalPrice * currentILSRate;
  }
  
  document.getElementById('priceILS').innerHTML = `
    <i class="fas fa-shekel-sign ml-1"></i>
    💰 המחיר ללקוח בשקלים: 
    <span class="text-4xl">₪${priceILS.toFixed(2)}</span>
    <br>
    <span class="text-sm text-gray-600">(שער: ${currentILSRate.toFixed(4)})</span>
  `;
}

function calculateInstallments() {
  const finalPrice = parseFloat(document.getElementById('finalPrice').textContent) || 0;
  const baseCurrency = document.getElementById('baseCurrency').value;
  const installments = parseInt(document.getElementById('installments').value) || 1;
  
  if (finalPrice === 0) {
    alert('אנא חשב מחיר תחילה!');
    return;
  }
  
  // Calculate ILS price based on base currency
  let priceILS = 0;
  if (baseCurrency === 'ILS') {
    priceILS = finalPrice;
  } else if (baseCurrency === 'EUR') {
    priceILS = finalPrice * ilsRate;
  } else {
    // For USD, GBP, or other currencies
    const baseToILS = exchangeRates['ILS'] || 1;
    const eurToBase = exchangeRates[baseCurrency] || 1;
    const currentILSRate = baseToILS / eurToBase;
    priceILS = finalPrice * currentILSRate;
  }
  
  let interestRate = 0;
  let totalWithInterest = priceILS;
  let interestAmount = 0;
  
  if (installments >= 6) {
    interestRate = 7;
    totalWithInterest = priceILS * 1.07;
    interestAmount = totalWithInterest - priceILS;
  } else if (installments >= 3) {
    interestRate = 3;
    totalWithInterest = priceILS * 1.03;
    interestAmount = totalWithInterest - priceILS;
  }
  
  const monthlyPayment = totalWithInterest / installments;
  const perPaymentBase = priceILS / installments;
  const perPaymentInterest = interestAmount / installments;
  
  // Interest info
  const interestInfo = document.getElementById('interestInfo');
  if (installments <= 2) {
    interestInfo.innerHTML = `
      <span class="text-green-600 font-bold text-lg">✅ ללא ריבית!</span><br>
      תשלום חודשי: <span class="font-bold text-2xl">₪${monthlyPayment.toFixed(2)}</span>
    `;
  } else {
    interestInfo.innerHTML = `
      <span class="text-orange-600 font-bold">ריבית: ${interestRate}% (₪${interestAmount.toFixed(2)})</span><br>
      תשלום חודשי: <span class="font-bold text-2xl">₪${monthlyPayment.toFixed(2)}</span>
    `;
  }
  
  // Payment table (like your Excel!)
  let tableHTML = `
    <div class="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 overflow-x-auto">
      <h4 class="font-bold text-blue-900 mb-3 text-lg">
        <i class="fas fa-table ml-1"></i>
        מחשבון תשלומים וריבית
      </h4>
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="bg-blue-200 text-blue-900">
            <th class="p-3 text-right border border-blue-300"></th>
            <th class="p-3 text-center border border-blue-300">סכום</th>
            <th class="p-3 text-center border border-blue-300">הערות</th>
          </tr>
        </thead>
        <tbody class="bg-white">
          <tr class="border-b border-blue-200">
            <td class="p-3 font-bold border border-blue-300">סכום לתשלום בש״ח</td>
            <td class="p-3 text-center text-xl font-bold text-blue-900 border border-blue-300">₪${priceILS.toFixed(1)}</td>
            <td class="p-3 text-center text-gray-600 border border-blue-300">מחיר ללקוח</td>
          </tr>
          <tr class="border-b border-blue-200">
            <td class="p-3 font-bold border border-blue-300">מספר תשלומים</td>
            <td class="p-3 text-center text-xl font-bold border border-blue-300">${installments}</td>
            <td class="p-3 text-center text-gray-600 border border-blue-300">תשלומים</td>
          </tr>
          <tr class="border-b border-blue-200">
            <td class="p-3 font-bold border border-blue-300">כל תשלום לפני ריבית</td>
            <td class="p-3 text-center border border-blue-300">₪${perPaymentBase.toFixed(1)}</td>
            <td class="p-3 text-center text-gray-600 border border-blue-300">קרן בלבד</td>
          </tr>
  `;
  
  if (installments >= 3) {
    tableHTML += `
          <tr class="bg-yellow-50 border-b border-blue-200">
            <td class="p-3 font-bold border border-blue-300">סה״כ לתשלום</td>
            <td class="p-3 text-center font-bold text-orange-600 border border-blue-300">₪${totalWithInterest.toFixed(0)}</td>
            <td class="p-3 text-center text-orange-600 border border-blue-300">+${interestRate}% ריבית</td>
          </tr>
          <tr class="bg-yellow-50 border-b border-blue-200">
            <td class="p-3 font-bold border border-blue-300">ריבית בכל תשלום</td>
            <td class="p-3 text-center font-bold text-orange-600 border border-blue-300">₪${perPaymentInterest.toFixed(0)}</td>
            <td class="p-3 text-center text-orange-600 border border-blue-300">ריבית</td>
          </tr>
    `;
  }
  
  tableHTML += `
          <tr class="bg-green-50">
            <td class="p-3 font-bold text-lg border border-blue-300">כל תשלום ${installments >= 3 ? '(כולל ריבית)' : '(ללא ריבית)'}</td>
            <td class="p-3 text-center font-bold text-2xl text-green-900 border border-blue-300">₪${monthlyPayment.toFixed(1)}</td>
            <td class="p-3 text-center text-green-600 font-bold border border-blue-300">${installments >= 3 ? '' : '✅ ללא ריבית'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  
  document.getElementById('paymentTable').innerHTML = tableHTML;
}

async function savePricing() {
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
    await axios.post('/api/pricings', {
      agent_id: AGENT_ID,
      title,
      currency,
      items,
      total_cost: totalCost,
      markup_percentage: markup,
      final_price: finalPrice,
      installments
    });
    
    alert('התמחור נשמר בהצלחה! ✅');
    document.getElementById('calculator').classList.add('hidden');
  } catch (error) {
    console.error('Failed to save:', error);
    alert('שגיאה בשמירה!');
  }
}
