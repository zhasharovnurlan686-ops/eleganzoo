const crypto = require('crypto');

const COOKIE_NAME = 'eleganzo_admin';
const PRODUCTS_PATH = 'products.json';

function env(name) {
  return String(process.env[name] || '').trim();
}

function config() {
  const token = env('GITHUB_TOKEN');
  const owner = env('GITHUB_OWNER');
  const repo = env('GITHUB_REPO');
  const branch = env('GITHUB_BRANCH') || 'main';
  const password = env('ADMIN_PASSWORD');

  const missing = [];
  if (!token) missing.push('GITHUB_TOKEN');
  if (!owner) missing.push('GITHUB_OWNER');
  if (!repo) missing.push('GITHUB_REPO');
  if (!password) missing.push('ADMIN_PASSWORD');

  if (missing.length) {
    const error = new Error(`Не настроены переменные Vercel: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }

  return { token, owner, repo, branch, password };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = decodeURIComponent(part.slice(i + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

function signature(password) {
  return crypto.createHmac('sha256', password).update('eleganzo-admin-session').digest('hex');
}

function isAuthenticated(req, password) {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value) return false;
  const expected = signature(password);
  try {
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

function setCookie(res, value, maxAge) {
  const secure = process.env.VERCEL === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify(body));
}

async function github(path, options = {}) {
  const { token, owner, repo } = config();
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Eleganzo-Admin',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }

  if (!response.ok) {
    const error = new Error(data.message || `GitHub API: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function getProducts() {
  const { branch } = config();
  const data = await github(`${PRODUCTS_PATH}?ref=${encodeURIComponent(branch)}`);

  if (!data.content) return { products: [], sha: data.sha };

  const decoded = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
  let products;
  try {
    products = JSON.parse(decoded);
  } catch (_) {
    const error = new Error('Файл products.json в GitHub содержит неправильный JSON.');
    error.status = 500;
    throw error;
  }

  if (!Array.isArray(products)) {
    const error = new Error('products.json должен содержать массив товаров.');
    error.status = 500;
    throw error;
  }

  return { products, sha: data.sha };
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) throw new Error('products должен быть массивом.');
  if (products.length > 1000) throw new Error('Слишком много товаров.');

  return products.map((p, index) => {
    if (!p || typeof p !== 'object') throw new Error(`Товар №${index + 1} имеет неверный формат.`);
    const name = String(p.name || '').trim();
    if (!name) throw new Error(`У товара №${index + 1} нет названия.`);

    return {
      id: p.id ?? `p-${Date.now()}-${index}`,
      name,
      description: String(p.description || ''),
      price: Number(p.price) || 0,
      oldPrice: p.oldPrice === null || p.oldPrice === '' || p.oldPrice === undefined ? null : (Number(p.oldPrice) || 0),
      stock: Math.max(0, Number(p.stock) || 0),
      category: String(p.category || 'other'),
      categoryName: String(p.categoryName || p.category || 'Без категории'),
      badge: String(p.badge || ''),
      variants: Array.isArray(p.variants) ? p.variants.map(String).slice(0, 30) : [],
      image: String(p.image || ''),
      active: p.active !== false
    };
  });
}

async function saveProducts(products) {
  const { branch } = config();
  const current = await getProducts();
  const normalized = normalizeProducts(products);
  const content = Buffer.from(JSON.stringify(normalized, null, 2) + '\n', 'utf8').toString('base64');

  const result = await github(PRODUCTS_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update products from Eleganzo admin',
      content,
      sha: current.sha,
      branch
    })
  });

  return { products: normalized, commit: result.commit?.sha || null };
}

function safeExtension(fileName, mime) {
  const fromName = String(fileName || '').toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)?.[1];
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function safeBaseName(fileName) {
  const raw = String(fileName || 'photo').replace(/\.[^.]+$/, '').toLowerCase();
  const cleaned = raw.normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return cleaned || 'photo';
}

async function uploadImage(body) {
  if (!body || typeof body.data !== 'string') throw new Error('Не передано изображение.');
  if (body.data.length > 7 * 1024 * 1024) throw new Error('Изображение слишком большое. Максимум около 3 МБ.');

  const match = body.data.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) throw new Error('Поддерживаются только JPG, PNG и WebP.');

  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Пустой файл изображения.');
  if (buffer.length > 3 * 1024 * 1024) throw new Error('Фото должно быть до 5 МБ.');

  const ext = safeExtension(body.fileName, mime);
  const name = `${safeBaseName(body.fileName)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const path = `products/${name}`;
  const { branch } = config();

  await github(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add product image ${name}`,
      content: buffer.toString('base64'),
      branch
    })
  });

  return { image: `/${path}` };
}

module.exports = async function handler(req, res) {
  try {
    const cfg = config();
    const action = req.query?.action || '';

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
      }

      if (action === 'image') {
        if (!isAuthenticated(req, cfg.password)) return json(res, 401, { error: 'Требуется вход в админку.' });
        return json(res, 200, await uploadImage(body));
      }

      if (action === 'save') {
        if (!isAuthenticated(req, cfg.password)) return json(res, 401, { error: 'Требуется вход в админку.' });
        const result = await saveProducts(body?.products);
        return json(res, 200, { ok: true, products: result.products, commit: result.commit });
      }

      if (body?.action === 'login') {
        if (String(body.password || '') !== cfg.password) return json(res, 401, { error: 'Неверный пароль.' });
        setCookie(res, signature(cfg.password), 60 * 60 * 24 * 7);
        return json(res, 200, { ok: true });
      }

      if (body?.action === 'logout') {
        setCookie(res, '', 0);
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET') {
      if (!isAuthenticated(req, cfg.password)) return json(res, 401, { error: 'Требуется вход в админку.' });
      const { products } = await getProducts();
      return json(res, 200, { products });
    }

    return json(res, 405, { error: 'Метод не поддерживается.' });
  } catch (error) {
    console.error('Eleganzo admin error:', error);
    return json(res, Number(error.status) >= 400 ? Number(error.status) : 500, {
      error: error.message || 'Внутренняя ошибка сервера.'
    });
  }
};
