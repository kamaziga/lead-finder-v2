const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'Укажите url из 2ГИС',
        instruction: '1. Откройте 2GIS.ru, найдите категорию\n2. Откройте DevTools (F12) → Network → XHR\n3. Найдите запрос "clustered"\n4. Скопируйте URL и вставьте сюда'
      });
    }

    console.log('Парсим URL:', url.substring(0, 80) + '...');

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://2gis.ru/'
      },
      timeout: 15000
    });

    const data = response.data;

    // Ищем компании в разных возможных местах
    let items = [];
    
    if (data.result && data.result.items) {
      items = data.result.items;
    } else if (data.result && Array.isArray(data.result)) {
      items = data.result;
    } else if (Array.isArray(data)) {
      items = data;
    } else if (data.items) {
      items = data.items;
    }

    if (items.length === 0) {
      return res.status(422).json({
        error: 'Не найдены данные компаний в ответе',
        hint: 'Проверьте URL. Возможно, сессия истекла.',
        receivedKeys: Object.keys(data)
      });
    }

    // Парсим компании
    let leads = items.map(item => {
      const name = item.name || 'Без названия';
      
      // Ищем телефон в ads.options.actions
      let phone = 'Телефон скрыт';
      let site = null;
      
      if (item.ads && item.ads.options && item.ads.options.actions) {
        item.ads.options.actions.forEach(action => {
          if (action.type === 'phone' && action.value) {
            phone = normalizePhone(action.value);
          }
          if (action.type === 'link' && action.value) {
            // Проверяем, что это не 2gis-ссылка
            if (!action.value.includes('2gis.ru') && !action.value.includes('link.2gis.ru')) {
              site = action.value;
            }
          }
        });
      }
      
      // Ищем сайт также в buy_here
      if (!site && item.ads && item.ads.options && item.ads.options.buy_here) {
        item.ads.options.buy_here.forEach(buy => {
          if (buy.actions) {
            buy.actions.forEach(action => {
              if (action.type === 'link' && action.value) {
                if (!action.value.includes('2gis.ru') && !action.value.includes('link.2gis.ru') && !action.value.includes('hh.ru')) {
                  site = action.value;
                }
              }
            });
          }
        });
      }

      return {
        name: name,
        phone: phone,
        city: '', // В этом запросе нет отдельного поля города
        address: '', // Адреса тоже нет в clustered
        site: site,
        source: '2gis'
      };
    });

    // Фильтруем: только без сайта + убираем дубликаты
    const seen = new Set();
    const noWebsite = leads.filter(lead => {
      if (lead.site) return false;
      const key = lead.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Найдено: ${leads.length}, без сайта: ${noWebsite.length}`);

    res.json({
      total: leads.length,
      filtered: noWebsite.length,
      leads: noWebsite
    });

  } catch (error) {
    console.error('Ошибка:', error.message);
    
    if (error.response && error.response.status === 403) {
      return res.status(403).json({
        error: '2ГИС заблокировал запрос',
        hint: 'Сессия истекла. Откройте 2GIS.ru, повторите поиск, скопируйте новый URL из DevTools → Network → XHR'
      });
    }
    
    res.status(500).json({ error: 'Ошибка сервера', message: error.message });
  }
});

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) {
    return '+7' + digits.slice(1);
  }
  return phone;
}

module.exports = router;