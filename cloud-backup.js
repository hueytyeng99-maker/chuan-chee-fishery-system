// Browser-side Supabase backup integration. The database access is protected by
// Supabase Auth and row-level security; only the public anon key belongs here.
const CLOUD_KEY = 'ccfishery.cloud.v1';
let cloudCfg = cloudRead(CLOUD_KEY, { url: '', anonKey: '' });
let cloudSession = cloudRead('ccfishery.cloud.session.v1', null);
let cloudTimer = null;
let cloudBusy = false;
const CLOUD_SYNC_MARK = 'ccfishery.cloud.lastSnapshot.v1';

function cloudRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function cloudPersist() {
  localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudCfg));
  if (cloudSession) localStorage.setItem('ccfishery.cloud.session.v1', JSON.stringify(cloudSession));
}
function cloudUrl(path) { return cloudCfg.url.replace(/\/+$/, '') + path; }
function cloudConfigFromForm() {
  const url = document.getElementById('cloudUrl')?.value.trim().replace(/\/+$/, '') || '';
  const anonKey = document.getElementById('cloudAnonKey')?.value.trim() || '';
  if (!/^https:\/\/[\w.-]+\.supabase\.co$/i.test(url) || !anonKey) {
    toast('请填入有效的 Supabase Project URL 和 anon public key');
    return false;
  }
  cloudCfg = { url, anonKey };
  cloudPersist();
  return true;
}
function cloudHeaders(extra = {}) {
  return { apikey: cloudCfg.anonKey, Authorization: `Bearer ${cloudSession?.access_token || cloudCfg.anonKey}`, ...extra };
}
function cloudStable(value) {
  if (Array.isArray(value)) return value.map(cloudStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, cloudStable(value[k])]));
  return value;
}
function cloudMarkSnapshot(value) {
  localStorage.setItem(CLOUD_SYNC_MARK, JSON.stringify(cloudStable(value)));
}
function cloudSnapshotsMatch(a, b) {
  return JSON.stringify(cloudStable(a)) === JSON.stringify(cloudStable(b));
}
async function cloudEnsureSession() {
  if (!cloudSession?.access_token) throw new Error('请先登录云端账号');
  if (Date.now() < (cloudSession.expires_at || 0) - 60000) return;
  const res = await fetch(cloudUrl('/auth/v1/token?grant_type=refresh_token'), {
    method: 'POST', headers: { apikey: cloudCfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: cloudSession.refresh_token })
  });
  const data = await res.json();
  if (!res.ok) { cloudSession = null; localStorage.removeItem('ccfishery.cloud.session.v1'); throw new Error('云端登录已过期，请重新登录'); }
  cloudSession = { ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
  cloudPersist();
}
function cloudMessage(error) {
  const message = String(error?.message || error || '连接失败');
  if (/Failed to fetch|NetworkError/i.test(message)) return '连接失败，请确认网址、网络和 Supabase 项目设置';
  if (/Invalid login credentials/i.test(message)) return '邮箱或密码不正确';
  if (/Email not confirmed/i.test(message)) return '请先到邮箱点击 Supabase 验证链接，再回来登录';
  return message;
}
function cloudBusyState(text) {
  cloudBusy = !!text;
  const el = document.getElementById('cloudStatus');
  if (el && text) el.textContent = text;
}

function showCloudBackup() {
  const email = cloudSession?.user?.email || '';
  const connected = !!cloudSession?.access_token;
  document.getElementById('modal').innerHTML = `<div class="modal" style="max-width:510px"><h2>云端备份</h2>
    <p>使用 Supabase 账号保存整份系统资料。每次本机资料变更后会自动上传；在其他电脑登录同一账号即可恢复。</p>
    <div class="field-group" style="margin-bottom:10px"><span class="field-label">Supabase Project URL</span><input class="field" id="cloudUrl" placeholder="https://xxxx.supabase.co" value="${esc(cloudCfg.url)}"></div>
    <div class="field-group" style="margin-bottom:10px"><span class="field-label">anon public key</span><input class="field" id="cloudAnonKey" autocomplete="off" placeholder="Supabase 项目公开 anon key" value="${esc(cloudCfg.anonKey)}"></div>
    ${connected ? `<div class="purchase-note" style="margin-bottom:12px">已登录：${esc(email)}。下方可立即备份或恢复。</div>` : `<div class="field-group" style="margin-bottom:10px"><span class="field-label">登录邮箱</span><input class="field" id="cloudEmail" type="email" autocomplete="username" value=""></div><div class="field-group"><span class="field-label">密码</span><input class="field" id="cloudPassword" type="password" autocomplete="current-password"></div>`}
    <div id="cloudStatus" class="purchase-note" style="margin-top:12px">${connected ? '云端账号已连接；本机更改会自动备份。' : '首次使用请先创建 Supabase 项目并运行 cloud-backup.sql。'}</div>
    <div class="modal-actions" style="flex-wrap:wrap"><button class="button light" onclick="closeModal()">关闭</button>
      ${connected ? `<button class="button light" onclick="cloudPullNow()">恢复云端资料</button><button class="button primary" onclick="cloudPushNow()">立即备份本机</button><button class="button light" onclick="cloudLogout()">退出登录</button>` : `<button class="button light" onclick="cloudSignUp()">创建账号</button><button class="button primary" onclick="cloudLogin()">登录并连接</button>`}
    </div></div>`;
  document.getElementById('modal').classList.add('open');
}

async function cloudAuth(kind) {
  if (!cloudConfigFromForm()) return;
  const email = document.getElementById('cloudEmail')?.value.trim();
  const password = document.getElementById('cloudPassword')?.value || '';
  if (!email || !password) { toast('请填写登录邮箱和密码'); return; }
  cloudBusyState(kind === 'signup' ? '正在创建账号…' : '正在登录…');
  try {
    const route = kind === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
    const res = await fetch(cloudUrl(route), { method: 'POST', headers: { apikey: cloudCfg.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.message || data.error_description || data.error || '登录失败');
    if (!data.access_token) {
      cloudBusy = false;
      const el = document.getElementById('cloudStatus');
      if (el) el.textContent = '账号已创建。请先到邮箱点击验证链接，再用此邮箱和密码登录。';
      return;
    }
    cloudSession = { ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
    cloudPersist();
    await cloudAfterLogin();
  } catch (e) {
    cloudBusy = false;
    const el = document.getElementById('cloudStatus');
    if (el) el.textContent = cloudMessage(e);
  }
}
function cloudLogin() { return cloudAuth('login'); }
function cloudSignUp() { return cloudAuth('signup'); }

async function cloudRequest(path, options = {}) {
  await cloudEnsureSession();
  const res = await fetch(cloudUrl(path), { ...options, headers: cloudHeaders(options.headers || {}) });
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    throw new Error(body.message || body.details || body.hint || `云端请求失败 (${res.status})`);
  }
  // PostgREST uses `return=minimal` for the backup upsert and may respond with
  // an empty body on success. Read text first so an empty successful response
  // is not misreported as a JSON parse failure after the write has completed.
  const responseText = await res.text();
  if (!responseText) return null;
  try { return JSON.parse(responseText); } catch { return null; }
}
async function cloudGetSnapshot() {
  const uid = cloudSession.user.id;
  const rows = await cloudRequest(`/rest/v1/ccfishery_backup?user_id=eq.${encodeURIComponent(uid)}&select=data,updated_at`, { headers: { Accept: 'application/json' } });
  return rows?.[0] || null;
}
async function cloudPutSnapshot() {
  if (!cloudSession?.user?.id) throw new Error('请先登录云端账号');
  const snapshot = JSON.parse(JSON.stringify(state));
  await cloudRequest('/rest/v1/ccfishery_backup?on_conflict=user_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: cloudSession.user.id, data: snapshot, updated_at: new Date().toISOString() })
  });
  cloudMarkSnapshot(snapshot);
}
async function cloudAfterLogin() {
  cloudBusyState('正在检查云端备份…');
  const backup = await cloudGetSnapshot();
  if (!backup) {
    await cloudPutSnapshot();
    cloudBusy = false;
    showCloudBackup();
    toast('已连接云端，并备份本机资料');
    return;
  }
  if (cloudSnapshotsMatch(backup.data, state)) {
    cloudMarkSnapshot(state);
    cloudBusy = false;
    showCloudBackup();
    toast('已连接云端；本机与云端资料一致');
    return;
  }
  cloudChooseSnapshot(backup);
}
function cloudChooseSnapshot(backup) {
  cloudBusy = false;
  document.getElementById('modal').innerHTML = `<div class="modal"><h2>选择要保留的资料</h2><p>云端已有备份（${esc(new Date(backup.updated_at).toLocaleString('zh-MY'))}）。选择一个版本作为当前资料；选择后会覆盖另一边。</p><div class="modal-actions"><button class="button light" onclick="cloudUseLocal()">保留本机并上传</button><button class="button primary" onclick="cloudUseRemote()">下载云端到本机</button></div><p id="cloudStatus" class="purchase-note" style="margin-top:12px">请确认选择，避免覆盖较新的单据或价格。</p></div>`;
  document.getElementById('modal').classList.add('open');
  window.cloudPendingBackup = backup;
}
function cloudApplyRemote() {
  cloudBusy = false;
  const data = window.cloudPendingBackup?.data;
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.customers) || !Array.isArray(data.docs)) throw new Error('云端备份格式无效');
  state = data;
  localStorage.setItem(KEY, JSON.stringify(state));
  cloudMarkSnapshot(state);
  window.cloudPendingBackup = null;
  closeModal();
  renderPage(page);
}
async function cloudUseRemote() {
  try { cloudBusyState('正在恢复云端资料…'); cloudApplyRemote(); toast('云端资料已恢复到本机'); }
  catch (e) { const el = document.getElementById('cloudStatus'); if (el) el.textContent = cloudMessage(e); }
}
async function cloudUseLocal() {
  try { cloudBusyState('正在备份本机资料…'); await cloudPutSnapshot(); window.cloudPendingBackup = null; cloudBusy = false; closeModal(); toast('本机资料已备份到云端'); }
  catch (e) { const el = document.getElementById('cloudStatus'); if (el) el.textContent = cloudMessage(e); }
}
async function cloudPushNow() {
  if (cloudBusy) return;
  cloudBusyState('正在上传备份…');
  try { await cloudPutSnapshot(); cloudBusy = false; const el = document.getElementById('cloudStatus'); if (el) el.textContent = `备份完成：${new Date().toLocaleString('zh-MY')}`; toast('本机资料已备份到云端'); }
  catch (e) { cloudBusy = false; const el = document.getElementById('cloudStatus'); if (el) el.textContent = cloudMessage(e); }
}
async function cloudPullNow() {
  if (cloudBusy) return;
  cloudBusyState('正在读取云端备份…');
  try { const backup = await cloudGetSnapshot(); if (!backup) throw new Error('云端暂时没有备份'); cloudChooseSnapshot(backup); }
  catch (e) { cloudBusy = false; const el = document.getElementById('cloudStatus'); if (el) el.textContent = cloudMessage(e); }
}
function cloudLogout() {
  cloudSession = null;
  localStorage.removeItem('ccfishery.cloud.session.v1');
  showCloudBackup();
  toast('已退出云端账号；本机资料保留');
}
function cloudQueueBackup() {
  if (!cloudSession?.access_token || cloudBusy) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(async () => {
    try { await cloudPutSnapshot(); }
    catch (e) { console.warn('Cloud backup failed:', cloudMessage(e)); }
  }, 900);
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  cloudQueueBackup();
}

// Resume an existing connection on this device. If its remote copy differs,
// ask before replacing local data.
if (cloudSession?.access_token && cloudCfg.url && cloudCfg.anonKey) {
  setTimeout(async () => {
    try {
      const backup = await cloudGetSnapshot();
      if (backup && !cloudSnapshotsMatch(backup.data, state)) cloudChooseSnapshot(backup);
      else if (backup) cloudMarkSnapshot(state);
      else await cloudPutSnapshot();
    } catch (e) { console.warn('Cloud backup reconnect failed:', cloudMessage(e)); }
  }, 1200);
}
