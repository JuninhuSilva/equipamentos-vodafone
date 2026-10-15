/* =====================================================================
   EQUIPAMENTOS VODAFONE — app.js
   Tudo corre no próprio telemóvel: câmara, leitura do código,
   base de dados (IndexedDB) e envio direto para a API do Telegram.
   ===================================================================== */

/* =====================================================================
   0. CONFIGURAÇÃO — edite aqui
   ---------------------------------------------------------------------
   TELEGRAM_TOKEN — o "token" do seu bot:
     1. No Telegram, procure @BotFather e abra a conversa.
     2. Envie /newbot, escolha um nome e um username (tem de acabar em "bot").
     3. O BotFather responde com um token parecido com
        123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw  → é esse.

   CHAT_ID — o número do GRUPO do supervisor:
     1. Adicione o bot ao grupo (Info do grupo > Adicionar membros).
     2. No grupo, escreva:  /start@UsernameDoBot
     3. Na app, abra Configurações (roda dentada) e toque em "Procurar grupos":
        a app mostra os grupos onde o bot está e guarda o ID com um toque.
        (Alternativa manual: abra no navegador
         https://api.telegram.org/bot<TOKEN>/getUpdates
         e procure "chat":{"id":-100xxxxxxxxxx ... "type":"supergroup"}.
         O ID de grupo começa SEMPRE com "-".)

   ATENÇÃO: o GitHub Pages exige um repositório PÚBLICO. Se escrever o
   token aqui, qualquer pessoa o pode ver e usar o seu bot. O mais seguro
   é deixar as duas constantes VAZIAS e preencher dentro da app, no ecrã
   Configurações — aí os dados ficam guardados só no seu telemóvel.
   Se preencher aqui, o valor da app (Configurações) tem prioridade.
   ===================================================================== */
const TELEGRAM_TOKEN = '';   // ex.: '123456789:AAH...'
const CHAT_ID = '';          // ex.: '-1001234567890'

/* Inferir o TIPO pelo código (opcional).
   Se descobrir que os códigos de cada tipo começam sempre igual, ponha a
   regra aqui e a app escolhe o tipo sozinha. Sem regra, usa o tipo
   escolhido no seletor. Exemplos (descomente e ajuste):
     { tipo: 'router',    regra: /^VF3/ },
     { tipo: 'box',       regra: /^VFB/ },
     { tipo: 'repetidor', regra: /^VFR/ },                                   */
const REGRAS_TIPO = [
];

const FOTO_QUALIDADE = 0.7;   // qualidade do JPEG (0 a 1)
const FOTO_LADO_MAX = 1280;   // maior lado da foto, em píxeis (menos = mais leve)
const NOME_GRUPO = 'Grupo do supervisor'; // só para mostrar na pré-visualização

/* FILTRO DE CÓDIGOS — as caixas têm vários códigos de barras. Pelos
   exemplos reais:
     Box    (amigo KSTB2281): lê-se o ATVHWID  06235000998911 (14 números)
     Router                 : lê-se o IMEI/MAC C0F6C24A39D4  (12 letras/números)
   e os que NÃO interessam são:
     EAN do produto 8 809218 901213 (13 números), 80001520 (8 números),
     Part No. 63101 (5 números).
   Regras usadas (não há um padrão único, por isso é por exclusão):
   - EAN do produto (8 ou 13 números) → ignorado;
   - menos de 10 caracteres → ignorado (Part No., 80001520…);
   - só números com 8, 12 ou 13 dígitos (formato de EAN/UPC) → ignorado;
   - só letras, números e hífen (links/textos → ignorado).
   - ignorar: códigos que começam por estes textos são sempre ignorados. */
const FILTRO_CODIGO = {
  ativo: false,        // DESLIGADO: lê o código que estiver na linha vermelha, seja qual for
  tamanhoMin: 10,
  tamanhoMax: 30,
  ignorar: []
};

/* FOTO DO EQUIPAMENTO INTEIRO — depois de ler o código, a app apita,
   pede para afastar o telemóvel e tira a foto sozinha passados estes
   segundos. 0 = foto no próprio momento da leitura (só a etiqueta). */
const FOTO_ATRASO_S = 0;

/* Se a app ignorar um código mas continuar a apontar para ele durante
   este tempo (milissegundos), aceita-o na mesma. */
const SEGURAR_MS = 1500;


/* =====================================================================
   1. CONSTANTES DA APP
   ===================================================================== */
const STATUS = {
  inst: { nome: 'Instalado', classe: 'st-inst', cor: '#0B7A3E' },
  cli:  { nome: 'Instalado do cliente', classe: 'st-cli', cor: '#1D5FC4' },
  api:  { nome: 'Apiado', classe: 'st-api', cor: '#A84F00' }
};
const ORDEM_STATUS = ['inst', 'cli', 'api'];
const TIPOS = { box: 'Box', router: 'Router', repetidor: 'Repetidor' };
const ORDEM_TIPOS = ['box', 'router', 'repetidor'];


/* =====================================================================
   2. UTILIDADES
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalizar = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

function lerLS(chave, padrao) { try { const v = localStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { return padrao; } }
function gravarLS(chave, valor) { try { if (valor === null || valor === '') localStorage.removeItem(chave); else localStorage.setItem(chave, valor); } catch (e) { /* sem espaço */ } }

const fmtData = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function dataBonita(ms) { return fmtData.format(new Date(ms)).replace('.', ''); }

/* Cada foto (Blob) ganha um endereço temporário para aparecer no ecrã */
const urlsFotos = new WeakMap();
function urlFoto(blob) {
  if (!blob) return '';
  let u = urlsFotos.get(blob);
  if (!u) { u = URL.createObjectURL(blob); urlsFotos.set(blob, u); }
  return u;
}
/* Fotos mostradas no ecrã, para abrir em tamanho grande */
const fotosVisiveis = new Map();

/* Aviso rápido no fundo do ecrã, com botão opcional (ex.: Desfazer) */
let toastTimer = null;
function toast(texto, acao) {
  $('toast-texto').textContent = texto;
  const b = $('toast-acao');
  if (acao) { b.textContent = acao.rotulo; b.hidden = false; b.onclick = () => { esconderToast(); acao.fazer(); }; }
  else { b.hidden = true; b.onclick = null; }
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(esconderToast, acao ? 5000 : 2200);
}
function esconderToast() { $('toast').hidden = true; }

/* Bip curto de confirmação de leitura (o iPhone não tem vibração na web) */
let audioCtx = null;
function prepararSom() {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* sem som */ }
}
function bip() {
  try {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.16);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.18);
  } catch (e) { /* sem som */ }
  if (navigator.vibrate) navigator.vibrate(60); // Android
}

function inferirTipo(codigo) {
  const c = normalizar(codigo);
  const r = REGRAS_TIPO.find((x) => x.regra.test(c));
  return r ? r.tipo : null;
}


/* =====================================================================
   3. BASE DE DADOS LOCAL (IndexedDB)
   ---------------------------------------------------------------------
   Lojas:
   - envios        { id, data, wo, total, contagem:{box,router,repetidor} }
                   índices: data, wo
   - equipamentos  { id, envioId, wo, data, codigo, codigoBusca, status, tipo, foto(Blob) }
                   índices: codigoBusca, envioId, data, wo
   - rascunho      a WO que está a ser preenchida (sobrevive se a app fechar)
   ===================================================================== */
const DB_NOME = 'equipamentos-vodafone';
const DB_VERSAO = 1;
let dbPromessa = null;

function abrirDB() {
  if (dbPromessa) return dbPromessa;
  dbPromessa = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NOME, DB_VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('envios')) {
        const s = db.createObjectStore('envios', { keyPath: 'id', autoIncrement: true });
        s.createIndex('data', 'data');
        s.createIndex('wo', 'wo');
      }
      if (!db.objectStoreNames.contains('equipamentos')) {
        const s = db.createObjectStore('equipamentos', { keyPath: 'id', autoIncrement: true });
        s.createIndex('codigoBusca', 'codigoBusca');
        s.createIndex('envioId', 'envioId');
        s.createIndex('data', 'data');
        s.createIndex('wo', 'wo');
      }
      if (!db.objectStoreNames.contains('rascunho')) db.createObjectStore('rascunho', { keyPath: 'chave' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromessa;
}

const pedido = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function loja(nome, modo) {
  const db = await abrirDB();
  return db.transaction(nome, modo || 'readonly').objectStore(nome);
}

/* Guarda um envio completo (WO + equipamentos com fotos) numa só transação */
async function guardarEnvio(wo, itens) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['envios', 'equipamentos'], 'readwrite');
    const data = Date.now();
    const contagem = { box: 0, router: 0, repetidor: 0 };
    itens.forEach((i) => { contagem[i.tipo] = (contagem[i.tipo] || 0) + 1; });
    let envioId = null;
    const r = t.objectStore('envios').add({ data, wo, total: itens.length, contagem });
    r.onsuccess = () => {
      envioId = r.result;
      const eq = t.objectStore('equipamentos');
      itens.forEach((i) => eq.add({
        envioId, wo, data,
        codigo: i.codigo, codigoBusca: normalizar(i.codigo),
        status: i.status, tipo: i.tipo, foto: i.foto
      }));
    };
    t.oncomplete = () => resolve(envioId);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function equipamentosDoEnvio(envioId) {
  const s = await loja('equipamentos');
  return pedido(s.index('envioId').getAll(envioId));
}

/* Envios mais recentes primeiro, desde uma data, até "limite" */
async function listarEnvios(desde, limite) {
  const s = await loja('envios');
  const faixa = desde ? IDBKeyRange.lowerBound(desde) : null;
  return new Promise((resolve, reject) => {
    const lista = [];
    const r = s.index('data').openCursor(faixa, 'prev');
    r.onsuccess = () => {
      const c = r.result;
      if (!c || lista.length >= limite) return resolve(lista);
      lista.push(c.value); c.continue();
    };
    r.onerror = () => reject(r.error);
  });
}

/* Totais por tipo num período (soma as contagens guardadas em cada envio) */
async function contarPeriodo(desde) {
  const s = await loja('envios');
  const envios = await pedido(desde ? s.index('data').getAll(IDBKeyRange.lowerBound(desde)) : s.getAll());
  const t = { box: 0, router: 0, repetidor: 0 };
  envios.forEach((e) => ORDEM_TIPOS.forEach((k) => { t[k] += (e.contagem && e.contagem[k]) || 0; }));
  return t;
}

async function enviosDaWo(wo) {
  const s = await loja('envios');
  const envios = await pedido(s.index('wo').getAll(wo));
  return envios.sort((a, b) => b.data - a.data);
}

/* Procura chaves de um índice: primeiro por prefixo (rápido), depois "contém" */
async function procurarIndice(nomeLoja, nomeIndice, q, contem) {
  const s = await loja(nomeLoja);
  const idx = s.index(nomeIndice);
  const porPrefixo = await pedido(idx.getAllKeys(IDBKeyRange.bound(q, q + '￿')));
  if (!contem || q.length < 3) return porPrefixo;
  const extra = await new Promise((resolve, reject) => {
    const achados = [];
    const r = idx.openKeyCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve(achados);
      if (typeof c.key === 'string' && c.key.indexOf(q) > 0) achados.push(c.primaryKey);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  });
  return porPrefixo.concat(extra);
}

/* Interpreta datas escritas como 13/10, 13-10-2026, 13.10.26 */
function intervaloDaData(texto) {
  const m = String(texto).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
  if (!m) return null;
  let ano = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (ano < 100) ano += 2000;
  const ini = new Date(ano, parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
  if (isNaN(ini)) return null;
  return [ini, ini + 86400000 - 1];
}

/* Busca por código, WO ou data. Devolve WOs encontradas com os seus equipamentos */
async function buscar(texto) {
  const q = normalizar(texto);
  const wosEncontradas = new Map();   // wo → Set de ids de equipamentos encontrados
  const marcar = (wo, idEq) => {
    if (!wosEncontradas.has(wo)) wosEncontradas.set(wo, new Set());
    if (idEq != null) wosEncontradas.get(wo).add(idEq);
  };
  let primeiroCodigo = null;

  // 1) Data
  const faixa = intervaloDaData(texto);
  if (faixa) {
    const s = await loja('envios');
    (await pedido(s.index('data').getAll(IDBKeyRange.bound(faixa[0], faixa[1])))).forEach((e) => marcar(e.wo));
  }

  // 2) Código do equipamento
  const idsEq = await procurarIndice('equipamentos', 'codigoBusca', q, true);
  if (idsEq.length) {
    const s = await loja('equipamentos');
    const eqs = await Promise.all(idsEq.slice(0, 200).map((id) => pedido(s.get(id))));
    eqs.filter(Boolean).forEach((e) => {
      marcar(e.wo, e.id);
      if (!primeiroCodigo || e.codigoBusca === q) primeiroCodigo = e;
    });
  }

  // 3) Número da WO
  const wosQ = await procurarIndice('envios', 'wo', q, true);
  if (wosQ.length) {
    const s = await loja('envios');
    const envios = await Promise.all(wosQ.slice(0, 100).map((id) => pedido(s.get(id))));
    envios.filter(Boolean).forEach((e) => marcar(e.wo));
  }

  // Monta os grupos (no máximo 30 WOs)
  const grupos = [];
  for (const [wo, achados] of Array.from(wosEncontradas.entries()).slice(0, 30)) {
    const envios = await enviosDaWo(wo);
    const itens = (await Promise.all(envios.map((e) => equipamentosDoEnvio(e.id)))).flat();
    grupos.push({ wo, data: envios.length ? envios[0].data : 0, envios: envios.length, itens, achados });
  }
  grupos.sort((a, b) => b.data - a.data);

  let destaque = null;
  if (primeiroCodigo) {
    const juntos = (await equipamentosDoEnvio(primeiroCodigo.envioId)).length - 1;
    destaque = { eq: primeiroCodigo, juntos };
  }
  return { grupos, destaque };
}

/* Rascunho: a WO em curso fica guardada mesmo que o iPhone feche a app */
let rascunhoTimer = null;
function guardarRascunho() {
  clearTimeout(rascunhoTimer);
  rascunhoTimer = setTimeout(async () => {
    try {
      const s = await loja('rascunho', 'readwrite');
      await pedido(s.put({ chave: 'atual', wo: estado.wo, woEnviada: estado.woEnviada, itens: estado.itens }));
    } catch (e) { console.warn('Rascunho não guardado', e); }
  }, 250);
}
async function carregarRascunho() {
  try {
    const s = await loja('rascunho');
    const r = await pedido(s.get('atual'));
    if (r) { estado.wo = r.wo || ''; estado.woEnviada = !!r.woEnviada; estado.itens = r.itens || []; }
  } catch (e) { console.warn('Rascunho não lido', e); }
}


/* =====================================================================
   4. ESTADO DA APP
   ===================================================================== */
const estado = {
  aba: 'registrar',
  wo: '',
  woEnviada: false,      // a mensagem "WO: ..." já foi enviada (num envio interrompido)
  itens: [],             // { id, codigo, status, tipo, foto(Blob), enviado }
  status: lerLS('eqv_status', 'inst'),
  tipo: lerLS('eqv_tipo', 'router'),
  novoId: null,
  periodo: lerLS('eqv_periodo', 'mes'),
  limite: 40,
  busca: '',
  detalheWo: null,
  enviando: false
};


/* =====================================================================
   5. ABA REGISTRAR
   ===================================================================== */
function botoesSegmentados(destino, chaves, rotulos, atual, aoEscolher, comPonto) {
  destino.innerHTML = chaves.map((k) => {
    const st = STATUS[k];
    return '<button type="button" class="seg-btn ' + (comPonto && st ? st.classe : '') + '" data-valor="' + k + '" aria-pressed="' + (k === atual) + '"' +
      (comPonto && st ? ' style="--cor:' + st.cor + '"' : '') + '>' +
      (comPonto ? '<span class="ponto" aria-hidden="true"></span>' : '') +
      '<span>' + esc(rotulos[k]) + '</span></button>';
  }).join('');
  destino.onclick = (ev) => {
    const b = ev.target.closest('.seg-btn');
    if (b) aoEscolher(b.dataset.valor);
  };
}

const NOMES_STATUS = Object.fromEntries(ORDEM_STATUS.map((k) => [k, STATUS[k].nome]));

function escolherStatus(k) { estado.status = k; gravarLS('eqv_status', k); renderSeletores(); }
function escolherTipo(k) { estado.tipo = k; gravarLS('eqv_tipo', k); renderSeletores(); }

function renderSeletores() {
  botoesSegmentados($('seg-status'), ORDEM_STATUS, NOMES_STATUS, estado.status, escolherStatus, true);
  botoesSegmentados($('seg-tipo'), ORDEM_TIPOS, TIPOS, estado.tipo, escolherTipo, false);
  if (!$('camera').hidden) {
    botoesSegmentados($('cam-status'), ORDEM_STATUS, { inst: 'Instalado', cli: 'Do cliente', api: 'Apiado' }, estado.status, escolherStatus, true);
    $('cam-tipo').classList.add('tipos');
    botoesSegmentados($('cam-tipo'), ORDEM_TIPOS, TIPOS, estado.tipo, escolherTipo, false);
  }
}

function htmlItem(it) {
  const st = STATUS[it.status];
  fotosVisiveis.set('r' + it.id, it.foto);
  return '<div class="item' + (it.id === estado.novoId ? ' novo' : '') + '" data-id="' + it.id + '">' +
    '<button type="button" class="thumb" data-foto="r' + it.id + '" aria-label="Ver foto de ' + esc(it.codigo) + '"><img src="' + urlFoto(it.foto) + '" alt=""></button>' +
    '<div class="item-info">' +
      '<div class="item-tags">' +
        '<button type="button" class="pill pill-tipo" data-acao="tipo" data-id="' + it.id + '" aria-label="Tipo: ' + TIPOS[it.tipo] + '. Toque para mudar">' + TIPOS[it.tipo] + '</button>' +
        '<button type="button" class="pill ' + st.classe + '" data-acao="status" data-id="' + it.id + '" aria-label="Status: ' + st.nome + '. Toque para mudar">' + st.nome + '</button>' +
      '</div>' +
      '<span class="codigo">' + esc(it.codigo) + '</span>' +
    '</div>' +
    '<button type="button" class="btn-lixo" data-acao="remover" data-id="' + it.id + '" aria-label="Remover ' + esc(it.codigo) + '">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>' +
    '</button></div>';
}

function renderLista() {
  const n = estado.itens.length;
  $('contagem').textContent = plural(n, 'equipamento', 'equipamentos');
  $('lista-wo').innerHTML = n
    ? estado.itens.map(htmlItem).join('')
    : '<p class="vazio">Escaneie o primeiro equipamento desta WO.</p>';
  $('dica-lista').hidden = n === 0;
  atualizarBotaoEnviar();
}

function atualizarBotaoEnviar() {
  const pronto = estado.wo.trim() !== '' && estado.itens.length > 0;
  $('btn-enviar').disabled = !pronto;
  $('aviso-envio').hidden = pronto;
  $('aviso-envio').textContent = !estado.wo.trim() && estado.itens.length
    ? 'Falta colar o número da WO.'
    : 'Preencha a WO e escaneie pelo menos um equipamento.';
}

function adicionarItem(codigo, foto, tipoEscolhido, statusEscolhido) {
  const tipo = tipoEscolhido || inferirTipo(codigo) || estado.tipo;
  const item = { id: novoId(), codigo: codigo.trim(), status: statusEscolhido || estado.status, tipo, foto, enviado: false };
  estado.itens.unshift(item);
  estado.novoId = item.id;
  guardarRascunho();
  renderLista();
  return item;
}

function removerItem(id) {
  const pos = estado.itens.findIndex((i) => i.id === id);
  if (pos < 0) return;
  const el = document.querySelector('.item[data-id="' + id + '"]');
  const [removido] = estado.itens.splice(pos, 1);
  const terminar = () => {
    guardarRascunho(); renderLista();
    toast('Removido: ' + removido.codigo, { rotulo: 'Desfazer', fazer: () => { estado.itens.splice(pos, 0, removido); guardarRascunho(); renderLista(); } });
  };
  if (el) { el.classList.add('saindo'); setTimeout(terminar, 180); } else terminar();
}

function mudarCampo(id, campo) {
  const it = estado.itens.find((i) => i.id === id);
  if (!it) return;
  const ordem = campo === 'tipo' ? ORDEM_TIPOS : ORDEM_STATUS;
  it[campo] = ordem[(ordem.indexOf(it[campo]) + 1) % ordem.length];
  estado.novoId = null;
  guardarRascunho(); renderLista();
  if (!$('camera').hidden) mostrarUltimo(it);
}

$('lista-wo').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  if (b.dataset.acao === 'remover') removerItem(b.dataset.id);
  if (b.dataset.acao === 'tipo') mudarCampo(b.dataset.id, 'tipo');
  if (b.dataset.acao === 'status') mudarCampo(b.dataset.id, 'status');
});

$('wo').addEventListener('input', () => {
  const novo = $('wo').value.trim();
  if (estado.woEnviada && novo !== estado.wo) estado.woEnviada = false; // WO mudou: reenviar a 1ª mensagem
  estado.wo = novo;
  guardarRascunho(); atualizarBotaoEnviar();
});

$('btn-colar').addEventListener('click', async () => {
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (!t) { toast('A área de transferência está vazia'); return; }
    $('wo').value = t; $('wo').dispatchEvent(new Event('input'));
    toast('WO colada');
  } catch (e) {
    $('wo').focus();
    toast('Toque e segure no campo para colar');
  }
});


/* =====================================================================
   6. CÂMARA + LEITURA DE CÓDIGO DE BARRAS
   ---------------------------------------------------------------------
   - Usa a câmara traseira ao vivo (getUserMedia).
   - Lê o código com o leitor nativo (BarcodeDetector, ex.: Android)
     ou com a biblioteca ZXing (iPhone).
   - No mesmo instante da leitura, copia o quadro do vídeo para um
     <canvas> e gera um JPEG. A foto NUNCA vai para a galeria:
     fica só dentro da app (IndexedDB).
   - Modo contínuo: vários equipamentos seguidos até tocar "Concluir".
   ===================================================================== */
const cam = {
  stream: null, track: null, ativo: false, timer: null,
  detetor: null, zxing: null,
  ultimoCodigo: '', ultimoQuando: 0, pausaAte: 0, lidos: 0, lanterna: false,
  pendente: null,          // leitura à espera de Confirmar / Cancelar
  ignorados: new Set(),    // códigos cancelados nesta sessão de câmara (não volta a perguntar)
  ultimoId: null,          // último item confirmado (para "Desfazer")
  cRecorte: document.createElement('canvas'),
  cFoto: document.createElement('canvas')
};

async function prepararLeitor() {
  if (cam.detetor || cam.zxing) return;
  // Leitor nativo, quando existe
  if ('BarcodeDetector' in window) {
    try {
      const desejados = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'qr_code', 'data_matrix'];
      const suportados = await window.BarcodeDetector.getSupportedFormats();
      const formatos = desejados.filter((f) => suportados.includes(f));
      if (formatos.length) { cam.detetor = new window.BarcodeDetector({ formats: formatos }); return; }
    } catch (e) { /* cai para ZXing */ }
  }
  // Leitor principal no iPhone: zxing-wasm (motor zxing-cpp, o mesmo tipo de
  // leitor das apps nativas — mais rápido e mais certeiro que o ZXing em JS).
  // Ficheiros em vendor/zxing-wasm-reader.js e vendor/zxing_reader.wasm (funciona offline).
  if (window.ZXingWASM && !cam.wasm) {
    try {
      await window.ZXingWASM.prepareZXingModule({
        overrides: {
          locateFile: (ficheiro, prefixo) => ficheiro.endsWith('.wasm')
            ? new URL('vendor/zxing_reader.wasm', location.href).href
            : prefixo + ficheiro
        },
        fireImmediately: true
      });
      cam.wasm = true;
    } catch (e) { console.warn('zxing-wasm indisponível, uso o ZXing em JS', e); }
  }
  // Reserva: ZXing em JS (vendor/zxing.min.js)
  const Z = window.ZXing;
  const dicas = new Map();
  dicas.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_93, Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.ITF, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
    Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX
  ]);
  dicas.set(Z.DecodeHintType.TRY_HARDER, true);
  cam.zxing = new Z.MultiFormatReader();
  cam.zxing.setHints(dicas);
}

/* Recorta do vídeo só a zona da moldura (mais rápido e mais certeiro) */
function recortarMira() {
  const v = $('video');
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const caixaV = v.getBoundingClientRect();
  const caixaM = document.querySelector('.camera-mira').getBoundingClientRect();
  // o vídeo está em "object-fit: cover": calcula a escala e o deslocamento
  const escala = Math.max(caixaV.width / vw, caixaV.height / vh);
  const dx = (caixaV.width - vw * escala) / 2, dy = (caixaV.height - vh * escala) / 2;
  // só uma faixa estreita à volta da LINHA VERMELHA é lida:
  // o código que a linha atravessa é o único que a app vê
  const folgaX = 0.05, FAIXA = 0.5;            // FAIXA = altura lida, em fração da moldura
  let w = caixaM.width / escala, h = (caixaM.height * FAIXA) / escala;
  const centroY = (caixaM.top + caixaM.height / 2 - caixaV.top - dy) / escala;
  let x = (caixaM.left - caixaV.left - dx) / escala, y = centroY - h / 2;
  x -= w * folgaX; w *= 1 + folgaX * 2;
  x = Math.max(0, x); y = Math.max(0, y); w = Math.min(vw - x, w); h = Math.min(vh - y, h);
  // sempre ~1100 px de largura: aumenta recortes pequenos (o ZXing lê melhor)
  const red = Math.max(1, 1100 / w);           // nunca reduz: códigos densos precisam de todos os píxeis
  const c = cam.cRecorte;
  c.width = Math.round(w * red); c.height = Math.round(h * red);
  c.getContext('2d', { willReadFrequently: true }).drawImage(v, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/* Devolve TODOS os códigos vistos na mira (o leitor nativo vê vários;
   o ZXing do iPhone devolve um de cada vez) */
/* Código lido com caracteres invisíveis/estranhos (ex.: o "⊠" no meio)
   = leitura falhada: é descartado e a app continua a tentar */
function limparCodigo(t) {
  const s = String(t || '').trim();
  if (!s || /[\u0000-\u001F\u007F-\u009F\uFFFD]/.test(s)) return null;
  return s;
}

async function detetarCodigos() {
  return (await detetarBruto()).map(limparCodigo).filter(Boolean);
}

async function detetarBruto() {
  const c = recortarMira();
  if (!c) return [];
  if (cam.detetor) {
    try {
      const r = await cam.detetor.detect(c);
      return Array.from(new Set(r.map((x) => String(x.rawValue || '').trim()).filter(Boolean)));
    } catch (e) { return []; }
  }
  if (cam.wasm) {
    try {
      const img = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      const r = await window.ZXingWASM.readBarcodes(img, {
        formats: ['Code128', 'Code39', 'Code93', 'Codabar', 'ITF', 'EAN-13', 'EAN-8', 'DataBar', 'DataBarExpanded'],
        tryHarder: true, tryRotate: false, tryInvert: true, tryDownscale: true,
        maxNumberOfSymbols: 1,
        minLineCount: 3              // 3 linhas de leitura têm de concordar: evita leituras erradas
      });
      return r.filter((x) => x.isValid).map((x) => x.text);
    } catch (e) { return []; }
  }
  try {
    const Z = window.ZXing;
    // alterna entre os dois "binarizadores" do ZXing: cada um lê melhor certas etiquetas
    cam.alterna = !cam.alterna;
    const lum = new Z.HTMLCanvasElementLuminanceSource(c);
    const bin = cam.alterna ? new Z.HybridBinarizer(lum) : new Z.GlobalHistogramBinarizer(lum);
    return [cam.zxing.decodeWithState(new Z.BinaryBitmap(bin)).getText().trim()];
  } catch (e) { return []; } // nenhum código neste quadro
}

/* Regras do FILTRO_CODIGO (topo do ficheiro) */
function codigoAceite(codigo) {
  const n = normalizar(codigo);
  const f = FILTRO_CODIGO;
  if (!f.ativo) return n.length >= 3;          // sem filtro: aceita o que estiver na linha
  if (n.length < f.tamanhoMin || n.length > f.tamanhoMax) return false;
  if (!/^[A-Z0-9\-:.\/]+$/.test(n)) return false;                   // links e textos com outros símbolos
  if (/^\d+$/.test(n) && [8, 13].includes(n.length)) return false;     // EAN-8 e EAN-13 (código do produto)
  if (f.ignorar.some((p) => n.startsWith(normalizar(p)))) return false;
  return true;
}

/* Foto do equipamento = quadro inteiro do vídeo, reduzido e em JPEG */
function capturarFoto() {
  const v = $('video');
  const vw = v.videoWidth, vh = v.videoHeight;
  const red = Math.min(1, FOTO_LADO_MAX / Math.max(vw, vh));
  const c = cam.cFoto;
  c.width = Math.round(vw * red); c.height = Math.round(vh * red);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', FOTO_QUALIDADE));
}

function msgCamera(t) { $('cam-msg').textContent = t; }

function mostrarUltimo(it) {
  const st = STATUS[it.status];
  const el = $('cam-ultimo');
  el.innerHTML = '<img src="' + urlFoto(it.foto) + '" alt="">' +
    '<div class="item-info"><div class="item-tags">' +
    '<button type="button" class="pill pill-tipo" data-acao="tipo" data-id="' + it.id + '">' + TIPOS[it.tipo] + '</button>' +
    '<button type="button" class="pill ' + st.classe + '" data-acao="status" data-id="' + it.id + '">' + st.nome + '</button>' +
    '</div><span class="codigo">' + esc(it.codigo) + '</span></div>' +
    '<button type="button" class="btn-desfazer" data-acao="desfazer" data-id="' + it.id + '">Desfazer</button>';
  el.hidden = false;
}
$('cam-ultimo').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  if (b.dataset.acao === 'desfazer') return desfazerUltimo(b.dataset.id);
  mudarCampo(b.dataset.id, b.dataset.acao);
});

/* Tira da lista o último equipamento confirmado (leu/confirmou errado) */
function desfazerUltimo(id) {
  const it = estado.itens.find((i) => i.id === id);
  if (!it) return;
  estado.itens = estado.itens.filter((i) => i.id !== id);
  cam.ignorados.add(normalizar(it.codigo));
  cam.lidos = Math.max(0, cam.lidos - 1);
  $('cam-contador').textContent = plural(cam.lidos, 'lido', 'lidos') + ' nesta sessão';
  $('cam-ultimo').hidden = true;
  guardarRascunho(); renderLista();
  msgCamera('Removido: ' + it.codigo + '. Aponte para o código certo');
  cam.pausaAte = Date.now() + 800;
}

/* Mostra/esconde os controlos normais da câmara enquanto se confirma */
function modoConfirmacao(ligado) {
  $('cam-confirmar').hidden = !ligado;
  document.querySelector('.camera-mira').style.visibility = ligado ? 'hidden' : ''; // ecrã limpo para enquadrar a foto
  $('cam-status').hidden = ligado;
  $('cam-tipo').hidden = ligado;
  $('cam-acoes').hidden = ligado;
  if (ligado) $('cam-ultimo').hidden = true;
}

/* Depois de ler: apita, pede para afastar e tira a foto sozinha.
   Nenhum toque é obrigatório; "Cancelar" e "Foto já" são opcionais. */
function mostrarContagem() {
  const p = cam.pendente;
  const st = STATUS[p.status];
  $('cam-confirmar').innerHTML =
    '<div class="conf-topo"><span class="conf-num" aria-hidden="true">' + p.falta + '</span>' +
      '<div class="item-info"><span class="conf-rotulo">Lido. Afaste para a foto do equipamento</span>' +
      '<span class="conf-codigo">' + esc(p.codigo) + '</span>' +
      '<div class="item-tags">' +
        '<button type="button" class="pill pill-tipo" data-acao="p-tipo" aria-label="Tipo: ' + TIPOS[p.tipo] + '. Toque para mudar">' + TIPOS[p.tipo] + '</button>' +
        '<button type="button" class="pill ' + st.classe + '" data-acao="p-status" aria-label="Status: ' + st.nome + '. Toque para mudar">' + st.nome + '</button>' +
      '</div></div></div>' +
    '<div class="conf-botoes">' +
      '<button type="button" class="conf-cancelar" data-acao="cancelar">Cancelar</button>' +
      '<button type="button" class="conf-ok" data-acao="foto">Foto já</button>' +
    '</div>';
  modoConfirmacao(true);
  msgCamera('Afaste o telemóvel: foto em ' + p.falta + '…');
}

function iniciarContagem(codigo) {
  cam.pendente = { codigo, tipo: inferirTipo(codigo) || estado.tipo, status: estado.status, falta: FOTO_ATRASO_S, timer: null };
  if (FOTO_ATRASO_S <= 0) return tirarFotoPendente();
  mostrarContagem();
  const passo = () => {
    const p = cam.pendente;
    if (!p || p.codigo !== codigo) return;
    p.falta -= 1;
    if (p.falta <= 0) return tirarFotoPendente();
    mostrarContagem();
    p.timer = setTimeout(passo, 1000);
  };
  cam.pendente.timer = setTimeout(passo, 1000);
}

async function tirarFotoPendente() {
  const p = cam.pendente;
  if (!p || p.aTirar) return;
  p.aTirar = true;
  clearTimeout(p.timer);
  const foto = await capturarFoto();          // quadro inteiro da câmara
  if (cam.pendente !== p) return;              // cancelado entretanto
  cam.pendente = null;
  modoConfirmacao(false);
  const it = adicionarItem(p.codigo, foto, p.tipo, p.status);
  cam.ultimoId = it.id;
  cam.lidos += 1;
  bip();
  const mira = document.querySelector('.camera-mira');
  mira.classList.add('lido'); setTimeout(() => mira.classList.remove('lido'), 600);
  $('cam-contador').textContent = plural(cam.lidos, 'lido', 'lidos') + ' nesta sessão';
  msgCamera('Adicionado! Aponte para o próximo código');
  mostrarUltimo(it);
  cam.ultimoCodigo = p.codigo; cam.ultimoQuando = Date.now();
  cam.pausaAte = Date.now() + 1500;
}

function cancelarPendente() {
  const p = cam.pendente;
  if (p) clearTimeout(p.timer);
  cam.pendente = null;
  modoConfirmacao(false);
  // o código cancelado não volta a ser lido enquanto a câmara estiver aberta
  if (p && p.codigo) cam.ignorados.add(normalizar(p.codigo));
  msgCamera('Cancelado. Aponte só para o código do equipamento');
  cam.pausaAte = Date.now() + 700;
}

$('cam-confirmar').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-acao]');
  const p = cam.pendente;
  if (!b || !p) return;
  const a = b.dataset.acao;
  if (a === 'cancelar') cancelarPendente();
  if (a === 'foto') tirarFotoPendente();
  if (a === 'p-tipo') { p.tipo = ORDEM_TIPOS[(ORDEM_TIPOS.indexOf(p.tipo) + 1) % ORDEM_TIPOS.length]; mostrarContagem(); }
  if (a === 'p-status') { p.status = ORDEM_STATUS[(ORDEM_STATUS.indexOf(p.status) + 1) % ORDEM_STATUS.length]; mostrarContagem(); }
});

/* Recebe os códigos vistos num quadro e decide o que fazer */
async function processarLeitura(codigos, manual) {
  const agora = Date.now();
  const naLista = (c) => estado.itens.some((i) => normalizar(i.codigo) === normalizar(c));
  let validos = codigos.filter((c) => !cam.ignorados.has(normalizar(c)));
  if (!manual) {
    const rejeitados = validos.filter((c) => !codigoAceite(c));
    validos = validos.filter(codigoAceite);
    if (!validos.length && rejeitados.length) {
      /* "Segurar para aceitar": se continuar a apontar para o mesmo código
         ignorado durante SEGURAR_MS, a app aceita-o na mesma. */
      const c = rejeitados[0];
      const ins = cam.insiste;
      if (!ins || ins.codigo !== c || agora - ins.ultimo > 700) {
        cam.insiste = { codigo: c, desde: agora, ultimo: agora };
      } else {
        ins.ultimo = agora;
      }
      const falta = SEGURAR_MS - (agora - cam.insiste.desde);
      if (falta > 0) {
        msgCamera('Ignorado: ' + c + '. Segure aqui para usar este código');
        cam.pausaAte = agora + 120;
        return;
      }
      cam.insiste = null;
      validos = [c];                                // o técnico insistiu: aceita
    } else {
      cam.insiste = null;
    }
  }
  const repetidos = validos.filter(naLista);
  validos = validos.filter((c) => !naLista(c));
  if (!validos.length) {
    if (repetidos.length) { msgCamera('Já está na lista: ' + repetidos[0]); cam.pausaAte = agora + 1500; }
    return;
  }
  cam.pausaAte = Infinity;                      // pára de ler até tirar a foto
  if (FOTO_ATRASO_S > 0) bip();                // com foto imediata, o bip toca só uma vez
  iniciarContagem(validos[0]);
}

async function ciclo() {
  if (!cam.ativo) return;
  const v = $('video');
  if (!cam.pendente && Date.now() >= cam.pausaAte && v.readyState >= 2) {
    const cods = await detetarCodigos();
    if (cods.length && cam.ativo && !cam.pendente) {
      // só aceita quando o MESMO código é lido em 2 quadros seguidos (evita leituras erradas)
      const agora = Date.now();
      if (cam.candidato === cods[0] && agora - cam.candidatoT < 1000) {
        cam.candidato = null;
        await processarLeitura([cods[0]], false);
      } else {
        cam.candidato = cods[0]; cam.candidatoT = agora;
      }
    }
  }
  if (cam.ativo) cam.timer = setTimeout(ciclo, 110);
}

async function abrirCamera() {
  prepararSom();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(location.protocol !== 'https:' ? 'A câmara só funciona com https://' : 'Este navegador não dá acesso à câmara');
    return;
  }
  $('camera').hidden = false;
  $('cam-ultimo').hidden = true;
  cam.lidos = 0; cam.ultimoCodigo = ''; cam.pausaAte = 0;
  cam.pendente = null; cam.ignorados = new Set();
  modoConfirmacao(false);
  $('cam-contador').textContent = '0 lidos nesta sessão';
  msgCamera('A abrir a câmara…');
  renderSeletores();
  try {
    await prepararLeitor();
    cam.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    const v = $('video');
    v.srcObject = cam.stream;
    await v.play();
    cam.track = cam.stream.getVideoTracks()[0];
    // Foco contínuo e lanterna, quando o telemóvel permite
    try {
      const cap = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
      if (cap.focusMode && cap.focusMode.includes('continuous')) await cam.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      $('btn-lanterna').hidden = !cap.torch;
    } catch (e) { $('btn-lanterna').hidden = true; }
    cam.ativo = true;
    msgCamera('Aponte para o código de barras');
    ciclo();
  } catch (e) {
    console.error(e);
    fecharCamera();
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      toast('Sem permissão da câmara. No iPhone: Ajustes > Safari > Câmara > Permitir');
    } else if (e && e.name === 'NotFoundError') {
      toast('Nenhuma câmara encontrada');
    } else {
      toast('Não foi possível abrir a câmara');
    }
  }
}

function fecharCamera() {
  cam.ativo = false;
  clearTimeout(cam.timer);
  if (cam.pendente) clearTimeout(cam.pendente.timer);
  cam.pendente = null; cam.ignorados = new Set();
  modoConfirmacao(false);
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null; cam.track = null; cam.lanterna = false;
  $('btn-lanterna').setAttribute('aria-pressed', 'false');
  $('video').srcObject = null;
  $('camera').hidden = true;
  $('folha-manual').hidden = true;
  if (cam.lidos) toast(plural(cam.lidos, 'equipamento adicionado', 'equipamentos adicionados'));
  cam.lidos = 0;
}

$('btn-escanear').addEventListener('click', abrirCamera);
$('btn-concluir').addEventListener('click', fecharCamera);
$('btn-lanterna').addEventListener('click', async () => {
  if (!cam.track) return;
  try {
    cam.lanterna = !cam.lanterna;
    await cam.track.applyConstraints({ advanced: [{ torch: cam.lanterna }] });
    $('btn-lanterna').setAttribute('aria-pressed', String(cam.lanterna));
  } catch (e) { toast('A lanterna não está disponível'); }
});
// Se a app for para segundo plano, desliga a câmara (poupa bateria)
document.addEventListener('visibilitychange', () => { if (document.hidden && cam.ativo) fecharCamera(); });

/* Código ilegível? Digita-se à mão; a foto é tirada da câmara na hora */
$('btn-digitar').addEventListener('click', () => {
  cam.pausaAte = Infinity;
  $('codigo-manual').value = '';
  $('folha-manual').hidden = false;
  setTimeout(() => $('codigo-manual').focus(), 50);
});
$('btn-manual-cancelar').addEventListener('click', () => { $('folha-manual').hidden = true; cam.pausaAte = Date.now() + 300; });
$('form-manual').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cod = $('codigo-manual').value.trim();
  if (!cod) { $('codigo-manual').focus(); return; }
  $('folha-manual').hidden = true;
  if (!cam.ativo) { toast('A câmara tem de estar aberta para tirar a foto'); return; }
  cam.ignorados.delete(normalizar(cod));   // digitado à mão: aceita sempre
  await processarLeitura([cod], true);
});


/* =====================================================================
   7. ENVIO PARA O TELEGRAM (Bot API)
   ---------------------------------------------------------------------
   1ª mensagem: sendMessage  →  "WO: 12345"
   Depois, por equipamento: sendPhoto com legenda "[status] [código]"
   Se falhar a meio, ao tentar de novo só envia o que faltou.
   ===================================================================== */
function config() {
  return {
    token: lerLS('eqv_token', '') || TELEGRAM_TOKEN,
    chat: lerLS('eqv_chat', '') || CHAT_ID
  };
}

class ErroEnvio extends Error {
  constructor(tipo, codigo, descricao, parametros) {
    super(descricao || tipo);
    this.tipo = tipo; this.codigo = codigo; this.descricao = descricao || ''; this.parametros = parametros || {};
  }
}

/* Chamada à API. Usa sempre FormData (evita bloqueios de CORS no navegador). */
async function telegram(metodo, campos, tokenProprio) {
  const token = tokenProprio || config().token;
  const fd = new FormData();
  Object.entries(campos || {}).forEach(([k, v]) => {
    if (v instanceof Blob) fd.append(k, v, 'foto.jpg'); else fd.append(k, String(v));
  });
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 60000);
  let resp;
  try {
    resp = await fetch('https://api.telegram.org/bot' + token + '/' + metodo, { method: 'POST', body: fd, signal: ctrl.signal });
  } catch (e) {
    throw new ErroEnvio(e.name === 'AbortError' ? 'tempo' : 'rede');
  } finally { clearTimeout(limite); }
  let json = null;
  try { json = await resp.json(); } catch (e) { throw new ErroEnvio('resposta', resp.status); }
  if (!json.ok) throw new ErroEnvio('telegram', json.error_code, json.description, json.parameters);
  return json.result;
}

/* Tenta de novo sozinho quando o Telegram pede para esperar (429)
   ou quando o grupo virou "supergrupo" e mudou de ID. */
async function telegramComRepeticao(metodo, montarCampos) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      return await telegram(metodo, montarCampos(config().chat));
    } catch (e) {
      if (e.codigo === 429 && e.parametros.retry_after && tentativa < 3) {
        $('pv-progresso').textContent = 'O Telegram pediu uma pausa de ' + e.parametros.retry_after + ' s…';
        await espera((e.parametros.retry_after + 1) * 1000);
        continue;
      }
      if (e.parametros.migrate_to_chat_id) {
        gravarLS('eqv_chat', String(e.parametros.migrate_to_chat_id));
        continue;
      }
      throw e;
    }
  }
  throw new ErroEnvio('telegram', 0, 'Demasiadas tentativas');
}

function mensagemDeErro(e) {
  if (!navigator.onLine || e.tipo === 'rede') return 'Sem ligação à internet. Verifique os dados móveis ou o Wi-Fi e tente de novo.';
  if (e.tipo === 'tempo') return 'O envio demorou demasiado (rede fraca). Tente de novo.';
  if (e.codigo === 401 || e.codigo === 404) return 'Token do bot inválido. Confira-o em Configurações (roda dentada no topo).';
  const d = (e.descricao || '').toLowerCase();
  if (e.codigo === 400 && d.includes('chat not found')) return 'Grupo não encontrado. Confira o Chat ID e se o bot está no grupo.';
  if (e.codigo === 403) return 'O bot não pode escrever no grupo (foi removido ou não tem permissão).';
  if (e.codigo === 400 && (d.includes('photo') || d.includes('file'))) return 'O Telegram recusou uma das fotos. Remova esse equipamento e escaneie de novo.';
  return 'Erro do Telegram: ' + (e.descricao || ('código ' + e.codigo));
}

function legenda(it) { return STATUS[it.status].nome + ' ' + it.codigo; }

function renderPreview() {
  $('pv-sub').textContent = 'Para: ' + NOME_GRUPO;
  $('pv-chat').innerHTML =
    '<div class="bolha bolha-texto">WO: ' + esc(estado.wo) + '</div>' +
    estado.itens.slice().reverse().map((it) =>
      '<div class="bolha bolha-foto">' +
        (it.enviado ? '<span class="enviado-marca">Enviado</span>' : '') +
        '<img src="' + urlFoto(it.foto) + '" alt="Foto de ' + esc(it.codigo) + '">' +
        '<p>' + esc(legenda(it)) + '</p></div>').join('');
}

function abrirPreview() {
  if (!estado.wo.trim() || !estado.itens.length) return;
  const c = config();
  if (!c.token || !c.chat) {
    abrirConfig('Antes do primeiro envio, configure o bot do Telegram.');
    return;
  }
  $('pv-erro').hidden = true;
  $('pv-progresso').hidden = true;
  $('btn-confirmar').textContent = 'Confirmar envio';
  $('btn-confirmar').disabled = false;
  $('btn-pv-voltar').disabled = false;
  renderPreview();
  $('folha-preview').hidden = false;
}

async function confirmarEnvio() {
  if (estado.enviando) return;
  estado.enviando = true;
  $('btn-confirmar').disabled = true; $('btn-pv-voltar').disabled = true;
  $('pv-erro').hidden = true; $('pv-progresso').hidden = false;
  // ordem de envio = ordem em que foram escaneados
  const fila = estado.itens.slice().reverse();
  const total = fila.length;
  try {
    if (!estado.woEnviada) {
      $('pv-progresso').textContent = 'A enviar a WO…';
      await telegramComRepeticao('sendMessage', (chat) => ({ chat_id: chat, text: 'WO: ' + estado.wo }));
      estado.woEnviada = true; guardarRascunho();
    }
    for (let i = 0; i < total; i++) {
      const it = fila[i];
      if (it.enviado) continue;
      $('pv-progresso').textContent = 'A enviar foto ' + (i + 1) + ' de ' + total + '…';
      await telegramComRepeticao('sendPhoto', (chat) => ({ chat_id: chat, photo: it.foto, caption: legenda(it) }));
      it.enviado = true; guardarRascunho(); renderPreview();
    }
  } catch (e) {
    console.error(e);
    const feitos = fila.filter((i) => i.enviado).length;
    $('pv-progresso').hidden = true;
    $('pv-erro').textContent = mensagemDeErro(e) +
      (feitos || estado.woEnviada ? ' Já foram enviados ' + feitos + ' de ' + total + '; ao tentar de novo, só vai o que falta.' : '');
    $('pv-erro').hidden = false;
    $('btn-confirmar').textContent = 'Tentar enviar de novo';
    $('btn-confirmar').disabled = false; $('btn-pv-voltar').disabled = false;
    estado.enviando = false;
    return;
  }

  // Tudo enviado: guarda no histórico e limpa a WO atual
  const wo = estado.wo, n = total;
  try {
    await guardarEnvio(wo, fila);
  } catch (e) {
    console.error(e);
    toast('Enviado, mas não foi possível guardar no histórico (memória cheia?)');
  }
  estado.itens = []; estado.wo = ''; estado.woEnviada = false; estado.novoId = null;
  $('wo').value = '';
  guardarRascunho(); renderLista();
  estado.enviando = false;
  $('folha-preview').hidden = true;
  $('ok-texto').textContent = plural(n, 'equipamento', 'equipamentos') + ' da WO ' + wo + (n === 1 ? ' foi enviado' : ' foram enviados') + ' ao grupo do supervisor.';
  $('tela-sucesso').hidden = false;
}

$('btn-enviar').addEventListener('click', abrirPreview);
$('btn-confirmar').addEventListener('click', confirmarEnvio);
$('btn-pv-voltar').addEventListener('click', () => { if (!estado.enviando) $('folha-preview').hidden = true; });
$('btn-nova-wo').addEventListener('click', () => { $('tela-sucesso').hidden = true; irPara('registrar'); });
$('btn-ver-hist').addEventListener('click', () => { $('tela-sucesso').hidden = true; estado.busca = ''; $('busca').value = ''; estado.detalheWo = null; irPara('historico'); });


/* =====================================================================
   8. ABA HISTÓRICO
   ===================================================================== */
function inicioPeriodo(p) {
  const h = new Date(); h.setHours(0, 0, 0, 0);
  if (p === 'semana') { const dia = (h.getDay() + 6) % 7; h.setDate(h.getDate() - dia); return h.getTime(); } // desde segunda-feira
  if (p === 'mes') { h.setDate(1); return h.getTime(); }
  return 0;
}

function htmlLinhaEq(e, encontrado) {
  const st = STATUS[e.status];
  fotosVisiveis.set('h' + e.id, e.foto);
  return '<span class="linha-eq' + (encontrado ? ' encontrado' : '') + '">' +
    '<img class="thumb" src="' + urlFoto(e.foto) + '" alt="">' +
    '<span class="item-info">' +
      '<span class="codigo">' + esc(e.codigo) + '</span>' +
      '<span class="item-tags"><span class="tipo-txt">' + (TIPOS[e.tipo] || e.tipo) + '</span>' +
      '<span class="pill ' + st.classe + '">' + st.nome + '</span>' +
      (encontrado ? '<span class="pill pill-encontrado">Encontrado</span>' : '') +
      '</span></span></span>';
}

function htmlCartao(g) {
  const temAchado = g.achados && g.achados.size > 0;
  return '<button type="button" class="cartao-wo' + (temAchado ? ' destaque' : '') + '" data-wo="' + esc(g.wo) + '">' +
    '<span class="cartao-cab"><span>' +
      '<span class="cartao-data">' + dataBonita(g.data) + (g.envios > 1 ? ' (' + g.envios + ' envios)' : '') + '</span>' +
      '<span class="cartao-wo-num">WO ' + esc(g.wo) + '</span></span>' +
      '<span class="cartao-qtd"><span>' + plural(g.itens.length, 'equip.', 'equip.') + '</span>' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span>' +
    '</span>' +
    g.itens.map((e) => htmlLinhaEq(e, temAchado && g.achados.has(e.id))).join('') +
  '</button>';
}

async function renderResumo() {
  botoesSegmentados($('seg-periodo'), ['semana', 'mes', 'tudo'], { semana: 'Esta semana', mes: 'Este mês', tudo: 'Tudo' }, estado.periodo, (p) => {
    estado.periodo = p; gravarLS('eqv_periodo', p); estado.limite = 40; renderHistorico();
  }, false);
  const t = await contarPeriodo(inicioPeriodo(estado.periodo));
  $('resumo').innerHTML = ORDEM_TIPOS.map((k) =>
    '<div class="resumo-card"><span class="resumo-num">' + t[k] + '</span><span class="resumo-rot">' + TIPOS[k] + '</span></div>').join('');
}

let geracao = 0; // evita mostrar resultados de uma busca antiga
async function renderHistorico() {
  const minha = ++geracao;
  if (estado.detalheWo) return renderDetalhe(minha);
  $('hist-detalhe-view').hidden = true;
  $('hist-lista-view').hidden = false;
  atualizarCabecalho();
  const q = estado.busca.trim();
  $('btn-limpar-busca').hidden = !q;
  $('hist-resumo').hidden = !!q;

  if (q) {
    const { grupos, destaque } = await buscar(q);
    if (minha !== geracao) return;
    $('btn-mais').hidden = true;
    $('resultado-info').hidden = false;
    $('resultado-info').textContent = grupos.length
      ? plural(grupos.length, 'WO encontrada', 'WOs encontradas') + ' em todo o histórico'
      : 'Nenhum resultado';
    let html = '';
    if (destaque) {
      const e = destaque.eq;
      html += '<div class="achado">' +
        '<span class="achado-a">' + esc(TIPOS[e.tipo] || e.tipo) + ' ' + esc(e.codigo) + ' foi enviado</span>' +
        '<span class="achado-b">na WO ' + esc(e.wo) + '</span>' +
        '<span class="achado-c">' + dataBonita(e.data) + (destaque.juntos > 0 ? ', junto com mais ' + plural(destaque.juntos, 'equipamento', 'equipamentos') : ', sozinho') + '.</span>' +
      '</div>';
    }
    html += grupos.map(htmlCartao).join('');
    if (!grupos.length) html = '<p class="vazio">Nenhum envio com "' + esc(q) + '". Confira o código, o número da WO ou a data (ex.: 13/10).</p>';
    $('hist-resultados').innerHTML = html;
    return;
  }

  $('resultado-info').hidden = true;
  await renderResumo();
  const envios = await listarEnvios(inicioPeriodo(estado.periodo), estado.limite);
  if (minha !== geracao) return;
  // Agrupa por WO (se a mesma WO foi enviada mais de uma vez, fica num só cartão)
  const mapa = new Map();
  for (const e of envios) {
    if (!mapa.has(e.wo)) mapa.set(e.wo, { wo: e.wo, data: e.data, envios: 0, ids: [] });
    const g = mapa.get(e.wo); g.envios += 1; g.ids.push(e.id);
  }
  const grupos = await Promise.all(Array.from(mapa.values()).map(async (g) => {
    g.itens = (await Promise.all(g.ids.map(equipamentosDoEnvio))).flat();
    return g;
  }));
  if (minha !== geracao) return;
  $('hist-resultados').innerHTML = grupos.length
    ? grupos.map(htmlCartao).join('')
    : '<p class="vazio">' + (estado.periodo === 'tudo' ? 'Ainda não há envios. Quando enviar uma WO, ela aparece aqui.' : 'Nenhum envio neste período.') + '</p>';
  $('btn-mais').hidden = envios.length < estado.limite;
}

async function renderDetalhe(minha) {
  $('hist-lista-view').hidden = true;
  const v = $('hist-detalhe-view');
  v.hidden = false;
  atualizarCabecalho();
  const envios = await enviosDaWo(estado.detalheWo);
  const blocos = await Promise.all(envios.map(async (e) => ({ e, itens: await equipamentosDoEnvio(e.id) })));
  if (minha !== geracao) return;
  if (!blocos.length) { v.innerHTML = '<p class="vazio">Esta WO não foi encontrada.</p>'; return; }
  v.innerHTML = blocos.map(({ e, itens }, n) =>
    (blocos.length > 1 ? '<h2 class="det-titulo">Envio ' + (blocos.length - n) + '</h2>' : '') +
    '<div class="info-envio">' +
      '<div class="info-linha"><span>Enviado em</span><span>' + dataBonita(e.data) + '</span></div>' +
      '<div class="info-linha"><span>WO</span><span>' + esc(e.wo) + '</span></div>' +
      '<div class="info-linha"><span>Equipamentos</span><span>' + itens.length + '</span></div>' +
    '</div>' +
    itens.map((it) => {
      const st = STATUS[it.status];
      fotosVisiveis.set('h' + it.id, it.foto);
      return '<div class="eq-grande">' +
        '<button type="button" class="foto" data-foto="h' + it.id + '" aria-label="Ampliar foto de ' + esc(it.codigo) + '"><img src="' + urlFoto(it.foto) + '" alt=""></button>' +
        '<div class="eq-grande-info"><div class="item-tags">' +
          '<span class="pill pill-tipo">' + (TIPOS[it.tipo] || it.tipo) + '</span>' +
          '<span class="pill ' + st.classe + '">' + st.nome + '</span></div>' +
          '<span class="codigo">' + esc(it.codigo) + '</span></div></div>';
    }).join('')
  ).join('');
  $('conteudo').scrollTop = 0;
}

$('hist-resultados').addEventListener('click', (ev) => {
  const c = ev.target.closest('.cartao-wo');
  if (!c) return;
  estado.detalheWo = c.dataset.wo;
  renderHistorico();
});
$('btn-voltar').addEventListener('click', () => { estado.detalheWo = null; renderHistorico(); });
$('btn-mais').addEventListener('click', () => { estado.limite += 40; renderHistorico(); });

let buscaTimer = null;
$('busca').addEventListener('input', () => {
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(() => { estado.busca = $('busca').value; renderHistorico(); }, 250);
});
$('busca').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('busca').blur(); });
$('btn-limpar-busca').addEventListener('click', () => { $('busca').value = ''; estado.busca = ''; renderHistorico(); });


/* =====================================================================
   9. CONFIGURAÇÕES DO TELEGRAM
   ===================================================================== */
function msgConfig(texto, ok) {
  const m = $('cfg-msg');
  m.textContent = texto; m.classList.toggle('ok', !!ok); m.hidden = !texto;
}

function abrirConfig(aviso) {
  const c = config();
  $('cfg-token').value = c.token;
  $('cfg-chat').value = c.chat;
  $('cfg-grupos').innerHTML = '';
  msgConfig(aviso || '', false);
  $('folha-config').hidden = false;
}

$('btn-config').addEventListener('click', () => abrirConfig());
$('btn-cfg-fechar').addEventListener('click', () => { $('folha-config').hidden = true; });

$('form-config').addEventListener('submit', (ev) => {
  ev.preventDefault();
  gravarLS('eqv_token', $('cfg-token').value.trim());
  gravarLS('eqv_chat', $('cfg-chat').value.trim());
  $('folha-config').hidden = true;
  toast('Configurações guardadas');
});

/* Lê as últimas mensagens que o bot recebeu e lista os grupos */
$('btn-descobrir').addEventListener('click', async () => {
  const token = $('cfg-token').value.trim();
  if (!token) { msgConfig('Cole primeiro o token do bot.'); return; }
  msgConfig('A procurar…', true);
  try {
    const atualizacoes = await telegram('getUpdates', { allowed_updates: '["message","my_chat_member"]' }, token);
    const grupos = new Map();
    atualizacoes.forEach((u) => {
      const chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
      if (chat && (chat.type === 'group' || chat.type === 'supergroup')) grupos.set(String(chat.id), chat.title || 'Grupo');
    });
    if (!grupos.size) {
      msgConfig('Nenhum grupo encontrado. Confirme que o bot está no grupo, escreva /start@UsernameDoBot no grupo e toque de novo em "Procurar grupos".');
      return;
    }
    msgConfig('Toque no grupo do supervisor:', true);
    $('cfg-grupos').innerHTML = Array.from(grupos.entries()).map(([id, nome]) =>
      '<button type="button" class="cfg-grupo" data-id="' + esc(id) + '"><strong>' + esc(nome) + '</strong><small>' + esc(id) + '</small></button>').join('');
  } catch (e) {
    if (e.codigo === 409) msgConfig('Este bot tem um webhook ativo; remova-o (deleteWebhook) ou cole o Chat ID à mão.');
    else msgConfig(mensagemDeErro(e));
  }
});
$('cfg-grupos').addEventListener('click', (ev) => {
  const b = ev.target.closest('.cfg-grupo');
  if (!b) return;
  $('cfg-chat').value = b.dataset.id;
  $('cfg-grupos').innerHTML = '';
  msgConfig('Grupo escolhido. Toque em "Guardar".', true);
});

$('btn-testar').addEventListener('click', async () => {
  const token = $('cfg-token').value.trim(), chat = $('cfg-chat').value.trim();
  if (!token || !chat) { msgConfig('Preencha o token e o Chat ID.'); return; }
  msgConfig('A enviar teste…', true);
  try {
    await telegram('sendMessage', { chat_id: chat, text: 'Teste da app Equipamentos Vodafone: ligação OK.' }, token);
    msgConfig('Mensagem de teste enviada. Veja o grupo no Telegram.', true);
  } catch (e) { msgConfig(mensagemDeErro(e)); }
});


/* =====================================================================
   10. NAVEGAÇÃO, FOTO GRANDE E ARRANQUE
   ===================================================================== */
function atualizarCabecalho() {
  const detalhe = estado.aba === 'historico' && estado.detalheWo;
  $('btn-voltar').hidden = !detalhe;
  $('titulo').textContent = estado.aba === 'registrar' ? 'Equipamentos Vodafone' : (detalhe ? 'WO ' + estado.detalheWo : 'Histórico');
}

function irPara(aba) {
  estado.aba = aba;
  if (aba === 'registrar') estado.detalheWo = null;
  $('aba-registrar').hidden = aba !== 'registrar';
  $('aba-historico').hidden = aba !== 'historico';
  $('barra-envio').hidden = aba !== 'registrar';
  document.querySelectorAll('.aba-btn').forEach((b) => {
    const ativa = b.dataset.aba === aba;
    b.classList.toggle('ativa', ativa);
    if (ativa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('conteudo').scrollTop = 0;
  atualizarCabecalho();
  if (aba === 'historico') renderHistorico();
}
document.querySelectorAll('.aba-btn').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.aba === 'historico' && estado.aba === 'historico') estado.detalheWo = null; // tocar de novo volta à lista
  irPara(b.dataset.aba);
}));

/* Tocar numa foto abre-a em ecrã inteiro */
document.addEventListener('click', (ev) => {
  const f = ev.target.closest('[data-foto]');
  if (!f) return;
  const blob = fotosVisiveis.get(f.dataset.foto);
  if (!blob) return;
  ev.stopPropagation();
  $('visor-img').src = urlFoto(blob);
  $('visor').hidden = false;
}, true);
$('btn-visor-fechar').addEventListener('click', () => { $('visor').hidden = true; });
$('visor').addEventListener('click', (ev) => { if (ev.target === $('visor')) $('visor').hidden = true; });

async function iniciar() {
  // Pede ao sistema para não apagar os dados da app quando houver pouco espaço
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* ok */ }
  await carregarRascunho();
  $('wo').value = estado.wo;
  renderSeletores();
  renderLista();
  irPara('registrar');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // updateViaCache 'none': procura sempre a versão nova do sw.js (sem cache)
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update();
      // sempre que a app volta ao ecrã, verifica se há atualização
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
    }).catch((e) => console.warn('Service worker', e));
    // quando a versão nova assume o controlo, recarrega uma vez (se não houver nada a meio)
    let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregou || estado.enviando || cam.ativo) return;
      recarregou = true;
      location.reload();
    });
  }
}
iniciar();
