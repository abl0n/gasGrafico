'use strict';

/* ================================================================
 * DATA LOGGER - ANÁLISE DE PRESSÃO
 * Zero dependências externas.
 *
 * Referência = pressão de trabalho (100%)
 *
 * Marcadores no gráfico (apenas bolinhas, cor por magnitude):
 *   🔴 Vermelho  5-9%    🔵 Azul      10-19%
 *   🟠 Laranja   20-29%  🟣 Roxo      30-34%
 *   🟡 Amarelo   35-39%  🟢 Verde     40-49%
 *   🟤 Marrom    50-59%  ⚫ Preto     60-79%
 *   💗 Magenta   80%+
 *
 * Estabilidade é marcada em verde-escuro (losango).
 * ================================================================ */

/* ----------------------------------------------------------------
 * ESTADO GLOBAL
 * ---------------------------------------------------------------- */
const State = {
    dadosProcessados: false,
    nivelSelecionado: '',
    rawTimes: [],
    rawPressures: [],
    logoDataURL: null,
    nextResponsavelId: 1,
    resizeObserver: null,
    currentChartData: null,
    currentPeaks: [],
    currentStablePoints: [],
    resizeTimeout: null
};

/* ----------------------------------------------------------------
 * UTILITÁRIOS
 * ---------------------------------------------------------------- */
const Utils = {
    extractTimeOnly(fullTime) {
        const m = String(fullTime).match(/(\d{2}:\d{2}:\d{2})/);
        return m ? m[1] : fullTime;
    },

    getPressaoReferencia() {
        const el = document.getElementById('pressaoTrabalho');
        const valor = parseFloat(el.value);
        return Number.isFinite(valor) && valor > 0 ? valor : null;
    },

    calcularDiferencaPercentual(valor, pressaoReferencia) {
        const v = Number(valor);
        const ref = Number(pressaoReferencia);
        if (!Number.isFinite(v) || !Number.isFinite(ref) || ref <= 0) return 0;
        return ((v - ref) / ref) * 100;
    },

    parseTimeToSeconds(str) {
        if (!str) return null;
        const m = String(str).match(/(\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?/);
        if (!m) return null;
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const sec = parseInt(m[3], 10);
        const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
        return h * 3600 + min * 60 + sec + ms / 1000;
    },

    formatDuracao(seg) {
        const s = Math.round(seg);
        if (s < 60) return `${s}s`;
        const min = Math.floor(s / 60);
        const resto = s % 60;
        return `${min}min ${resto}s`;
    }
};

/* ----------------------------------------------------------------
 * PALETA DE PICOS — cor por magnitude (%)
 * ---------------------------------------------------------------- */
const PEAK_PALETTE = [
    { min: 80, fill: '#e91e63', border: '#ad1457', label: '≥ 80%' },
    { min: 60, fill: '#212121', border: '#000000', label: '≥ 60%' },
    { min: 50, fill: '#795548', border: '#4e342e', label: '≥ 50%' },
    { min: 40, fill: '#2c9e6e', border: '#1a6e4a', label: '≥ 40%' },
    { min: 35, fill: '#f9c022', border: '#b8860b', label: '≥ 35%' },
    { min: 30, fill: '#8e44ad', border: '#5b2c6f', label: '≥ 30%' },
    { min: 20, fill: '#e67e22', border: '#a04000', label: '≥ 20%' },
    { min: 10, fill: '#3b82f6', border: '#1e40af', label: '≥ 10%' },
    { min: 5,  fill: '#c07070', border: '#a05050', label: '5-9%' }
];

const PEAK_COLORS = {
    classificacao(percentual) {
        const abs = Math.abs(percentual);
        for (const p of PEAK_PALETTE) {
            if (abs >= p.min) return { fill: p.fill, border: p.border, label: p.label };
        }
        return { fill: '#c07070', border: '#a05050', label: '< 5%' };
    }
};

/* ----------------------------------------------------------------
 * PARSER CSV (nativo, sem dependências)
 * ---------------------------------------------------------------- */
const CSVParser = {
    detectDelimiter(text) {
        const firstLine = text.split(/\r?\n/, 1)[0] || '';
        const candidates = [',', ';', '\t', '|'];
        let best = ',', bestCount = -1;
        for (const d of candidates) {
            const count = firstLine.split(d).length - 1;
            if (count > bestCount) { bestCount = count; best = d; }
        }
        return bestCount > 0 ? best : ',';
    },

    parse(text, delimiter) {
        const delim = delimiter || this.detectDelimiter(text);
        const rows = [];
        let row = [], field = '', inQuotes = false, i = 0;
        const len = text.length;

        if (len > 0 && text.charCodeAt(0) === 0xFEFF) i = 1;

        while (i < len) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { field += '"'; i += 2; }
                    else { inQuotes = false; i++; }
                } else { field += ch; i++; }
            } else {
                if (ch === '"') { inQuotes = true; i++; }
                else if (ch === delim) { row.push(field); field = ''; i++; }
                else if (ch === '\r') { i++; }
                else if (ch === '\n') {
                    row.push(field); field = '';
                    if (row.length > 1 || row[0] !== '') rows.push(row);
                    row = []; i++;
                } else { field += ch; i++; }
            }
        }
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);
        return rows;
    }
};

/* ----------------------------------------------------------------
 * DETECTOR — Picos e Estabilidades
 * ---------------------------------------------------------------- */
const Detector = {
    // Picos
    PICO_MIN_WAVE_PCT: 5,       // altura mínima da "onda"
    PICO_MIN_DISTANCE: 5,       // distância mínima entre picos (pontos)

    // Estabilidade
    ESTAB_DURACAO_SEG: 180,     // 3 minutos
    ESTAB_TOLERANCIA_PCT: 2,    // ±2%
    ESTAB_MIN_GAP_SEG: 60,      // 1 min entre marcações

    /* --------------------------------------------------------------
     * PICOS — máximos/mínimos locais (eletrocardiograma)
     * -------------------------------------------------------------- */
    detectPeaks(pressures, pressaoRef) {
        if (!Array.isArray(pressures) || pressures.length < 3) return [];
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) return [];

        const minWave = (this.PICO_MIN_WAVE_PCT / 100) * pressaoRef;
        const minDist = this.PICO_MIN_DISTANCE;

        // Encontra extremos locais
        const extremos = [];
        for (let i = 1; i < pressures.length - 1; i++) {
            const a = Number(pressures[i - 1]);
            const b = Number(pressures[i]);
            const c = Number(pressures[i + 1]);
            if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;

            if (b > a && b >= c) extremos.push({ index: i, value: b, tipo: 'max' });
            else if (b < a && b <= c) extremos.push({ index: i, value: b, tipo: 'min' });
        }

        // Filtra por alternância + altura mínima
        const picos = [];
        let ultimo = null;
        for (const e of extremos) {
            if (!ultimo) { ultimo = e; continue; }
            if (e.tipo === ultimo.tipo) {
                if (e.tipo === 'max' && e.value > ultimo.value) ultimo = e;
                else if (e.tipo === 'min' && e.value < ultimo.value) ultimo = e;
                continue;
            }
            const altura = Math.abs(e.value - ultimo.value);
            if (altura >= minWave) {
                const dpA = Math.abs(ultimo.value - pressaoRef);
                const dpB = Math.abs(e.value - pressaoRef);
                const escolhido = dpA >= dpB ? ultimo : e;
                picos.push({
                    index: escolhido.index,
                    value: escolhido.value,
                    tipo: escolhido.tipo,
                    variacaoPercentual: ((escolhido.value - pressaoRef) / pressaoRef) * 100
                });
            }
            ultimo = e;
        }

        // Distância mínima
        const filtrados = [];
        for (const p of picos) {
            const last = filtrados[filtrados.length - 1];
            if (!last || p.index - last.index >= minDist) {
                filtrados.push(p);
            } else if (Math.abs(p.variacaoPercentual) > Math.abs(last.variacaoPercentual)) {
                filtrados[filtrados.length - 1] = p;
            }
        }
        return filtrados;
    },

    /* --------------------------------------------------------------
     * ESTABILIDADE — marca INÍCIO e FIM de cada trecho estável
     * Variação tolerada: ±ESTAB_TOLERANCIA_PCT da referência
     * Duração mínima: ESTAB_DURACAO_SEG segundos
     * -------------------------------------------------------------- */
    detectStabilityStarts(pressures, times, pressaoRef) {
        if (!Array.isArray(pressures) || pressures.length < 5) return [];
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) return [];

        const tol = this.ESTAB_TOLERANCIA_PCT / 100;
        const minSeg = this.ESTAB_DURACAO_SEG;
        const minGapSeg = this.ESTAB_MIN_GAP_SEG;

        const tempo = times.map(t => Utils.parseTimeToSeconds(t));
        const dentro = (v) => Number.isFinite(v) && Math.abs(v - pressaoRef) / pressaoRef <= tol;

        // Segmenta em regiões contíguas dentro da faixa
        const regioes = [];
        let inicio = -1;
        for (let i = 0; i < pressures.length; i++) {
            if (dentro(Number(pressures[i]))) {
                if (inicio === -1) inicio = i;
            } else {
                if (inicio !== -1) { regioes.push({ inicio, fim: i - 1 }); inicio = -1; }
            }
        }
        if (inicio !== -1) regioes.push({ inicio, fim: pressures.length - 1 });

        // Cada região estável gera 2 marcações: início e fim
        const result = [];
        let ultimoT = -Infinity;

        for (const r of regioes) {
            const tIni = tempo[r.inicio];
            const tFim = tempo[r.fim];
            let dur = 0;
            if (Number.isFinite(tIni) && Number.isFinite(tFim) && tFim >= tIni) dur = tFim - tIni;
            else dur = r.fim - r.inicio;

            if (dur < minSeg) continue;
            if (Number.isFinite(tIni) && tIni - ultimoT < minGapSeg) continue;

            // ---- Marcador de INÍCIO ----
            result.push({
                index: r.inicio,
                indexFim: r.fim,
                time: times[r.inicio],
                timeFim: times[r.fim],
                value: pressures[r.inicio],
                duracaoSegundos: dur,
                papel: 'inicio'
            });

            // ---- Marcador de FIM ----
            // Só marca o fim se o trecho for razoavelmente longo
            // (evita duplicar em trechos muito curtos que só bateram o mínimo)
            if (dur >= minSeg * 1.2 && r.fim > r.inicio + 5) {
                result.push({
                    index: r.fim,
                    indexFim: r.fim,
                    time: times[r.fim],
                    timeFim: times[r.fim],
                    value: pressures[r.fim],
                    duracaoSegundos: dur,
                    papel: 'fim'
                });
            }

            ultimoT = Number.isFinite(tIni) ? tIni : r.inicio;
        }
        return result;
    },
};

/* ----------------------------------------------------------------
 * STATUS CLASSIFIER (badges na tabela)
 * ---------------------------------------------------------------- */
const StatusClassifier = {
    get(percentual) {
        const abs = Math.abs(percentual);
        const sinal = percentual >= 0 ? '🔴 ALTO' : '📉 BAIXO';
        if (abs >= 80) return { class: 'status-alto-100', text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 60) return { class: 'status-alto-80',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 50) return { class: 'status-alto-60',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 40) return { class: 'status-alto-50',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 35) return { class: 'status-alto-40',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 30) return { class: 'status-alto-30',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 20) return { class: 'status-alto-20',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 10) return { class: 'status-alto-10',  text: `${sinal} ${Math.round(abs)}%` };
        if (abs >= 5)  return { class: 'status-alto-10',  text: `${sinal} ${Math.round(abs)}%` };
        return { class: 'status-normal', text: '✓ NORMAL' };
    }
};

/* ----------------------------------------------------------------
 * RESPONSÁVEIS
 * ---------------------------------------------------------------- */
const Responsaveis = {
    grid: null, reportGrid: null, reportSection: null,

    init() {
        this.grid = document.getElementById('responsaveisGrid');
        this.reportGrid = document.getElementById('responsaveisReportGrid');
        this.reportSection = document.getElementById('responsaveisReport');

        document.getElementById('btnAddResponsavel')
            .addEventListener('click', () => this.adicionar());

        this.grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-responsavel');
            if (!btn) return;
            const card = btn.closest('.responsavel-card');
            if (card) { card.remove(); this.atualizarRelatorio(); }
        });

        this.grid.addEventListener('input', () => this.atualizarRelatorio());
        this.adicionar();
    },

    adicionar() {
        const card = document.createElement('div');
        card.className = 'responsavel-card';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-remove-responsavel';
        btn.textContent = 'Remover';

        const row = document.createElement('div');
        row.className = 'responsavel-row';

        const fields = [
            { cls: 'resp-nome', placeholder: 'Nome completo' },
            { cls: 'resp-cargo', placeholder: 'Cargo / Função' },
            { cls: 'resp-registro', placeholder: 'Registro / Matrícula' }
        ];

        for (const f of fields) {
            const wrap = document.createElement('div');
            wrap.className = 'responsavel-field';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = f.cls;
            input.placeholder = f.placeholder;
            wrap.appendChild(input);
            row.appendChild(wrap);
        }

        card.append(btn, row);
        this.grid.appendChild(card);
        this.atualizarRelatorio();
    },

    coletar() {
        return Array.from(this.grid.querySelectorAll('.responsavel-card'))
            .map(card => ({
                nome: card.querySelector('.resp-nome')?.value || '',
                cargo: card.querySelector('.resp-cargo')?.value || '',
                registro: card.querySelector('.resp-registro')?.value || ''
            }))
            .filter(r => r.nome || r.cargo || r.registro);
    },

    atualizarRelatorio() {
        const lista = this.coletar();
        if (lista.length === 0) {
            this.reportSection.hidden = true;
            this.reportGrid.replaceChildren();
            return;
        }
        this.reportSection.hidden = false;

        const frag = document.createDocumentFragment();
        for (const r of lista) {
            const card = document.createElement('div');
            card.className = 'responsavel-report-card';
            const nome = document.createElement('div');
            nome.className = 'nome'; nome.textContent = r.nome || '—';
            const cargo = document.createElement('div');
            cargo.className = 'cargo'; cargo.textContent = r.cargo || '—';
            const reg = document.createElement('div');
            reg.className = 'registro'; reg.textContent = r.registro || '—';
            card.append(nome, cargo, reg);
            frag.appendChild(card);
        }
        this.reportGrid.replaceChildren(frag);
    }
};

/* ----------------------------------------------------------------
 * LOGO
 * ---------------------------------------------------------------- */
const Logo = {
    MAX_SIZE: 2 * 1024 * 1024,

    init() {
        this.input = document.getElementById('logoInput');
        this.btnAdd = document.getElementById('btnAdicionarLogo');
        this.btnRemove = document.getElementById('btnRemoverLogo');
        this.preview = document.getElementById('logoPreview');
        this.reportLogo = document.getElementById('reportLogo');

        this.btnAdd.addEventListener('click', () => this.input.click());
        this.btnRemove.addEventListener('click', () => {
            State.logoDataURL = null;
            this.input.value = '';
            this.render();
        });
        this.input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            if (file.size > this.MAX_SIZE) {
                alert(`Logo muito grande. Máximo: ${this.MAX_SIZE / 1024 / 1024} MB`);
                this.input.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => { State.logoDataURL = ev.target.result; this.render(); };
            reader.onerror = () => alert('Erro ao ler a imagem.');
            reader.readAsDataURL(file);
        });
        this.render();
    },

    render() {
        if (State.logoDataURL) {
            this.preview.replaceChildren(this._img());
            this.reportLogo.replaceChildren(this._img());
            this.btnRemove.hidden = false;
        } else {
            const ph = document.createElement('div');
            ph.className = 'logo-placeholder';
            ph.textContent = 'Logo da Empresa';
            this.preview.replaceChildren(ph);
            this.reportLogo.replaceChildren();
            this.btnRemove.hidden = true;
        }
    },

    _img() {
        const img = document.createElement('img');
        img.src = State.logoDataURL;
        img.alt = 'Logo';
        return img;
    }
};

/* ----------------------------------------------------------------
 * RELATÓRIO / FORMULÁRIO
 * ---------------------------------------------------------------- */
const Relatorio = {
    els: {},

    init() {
        this.els = {
            equipamento: document.getElementById('equipamento'),
            endereco: document.getElementById('endereco'),
            pressao: document.getElementById('pressaoTrabalho'),
            pressaoDestaque: document.getElementById('pressaoDestaqueValor'),
            obs: document.getElementById('obs'),
            obsItem: document.getElementById('obsReportItem'),
            reportObs: document.getElementById('reportObs'),
            reportEquip: document.getElementById('reportEquipamento'),
            reportEnd: document.getElementById('reportEndereco'),
            reportPressao: document.getElementById('reportPressaoTrabalho'),
            reportClass: document.getElementById('reportClassificacao'),
            reportNivel: document.getElementById('reportNivel'),
            reportDataHora: document.getElementById('reportDataHora'),
            reportHeader: document.getElementById('reportHeader')
        };

        this.els.pressao.addEventListener('input', () => this.atualizarPressaoDestaque());
        this.els.obs.addEventListener('input', () => this.atualizarObservacoes());


        [this.els.equipamento, this.els.endereco].forEach(el => {
            el.addEventListener('input', () => this.atualizarCabecalho());
        });

        // Pressão de trabalho: ao mudar, atualiza destaque + cabeçalho
        // Se houver dados processados, reanalisa automaticamente
        this.els.pressao.addEventListener('input', () => {
            this.atualizarPressaoDestaque();
            this.atualizarCabecalho();

            // Reanalisa se já houver dados carregados
            if (State.dadosProcessados && State.rawPressures.length > 0) {
                App.reanalisar();
            }
        });


        document.querySelectorAll('input[name="tipoManutencao"]').forEach(el => {
            el.addEventListener('change', () => this.atualizarCabecalho());
        });
        document.querySelectorAll('.nivel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nivel-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                State.nivelSelecionado = btn.dataset.nivel;
                this.atualizarCabecalho();
            });
        });
        this.atualizarPressaoDestaque();
    },

    atualizarPressaoDestaque() {
        const valor = parseFloat(this.els.pressao.value);
        const valido = Number.isFinite(valor) && valor > 0;
        this.els.pressao.classList.toggle('input-invalid', !valido);
        this.els.pressaoDestaque.textContent = valido
            ? `${valor.toFixed(3)} Bar`
            : '— Bar';
    },

    atualizarObservacoes() {
        const v = this.els.obs.value.trim();
        if (v) {
            this.els.reportObs.textContent = v;
            this.els.reportObs.classList.add('multiline');
            this.els.obsItem.hidden = false;
        } else {
            this.els.obsItem.hidden = true;
        }
    },

    getClassificacaoTexto() {
        const checked = document.querySelector('input[name="tipoManutencao"]:checked');
        return checked ? checked.value : 'Não informado';
    },

    atualizarCabecalho() {
        this.els.reportEquip.textContent = this.els.equipamento.value || '—';
        this.els.reportEnd.textContent = this.els.endereco.value || '—';
        this.els.reportPressao.textContent = this.els.pressao.value
            ? `${this.els.pressao.value} Bar` : '—';
        this.els.reportClass.textContent = this.getClassificacaoTexto();

        const nivel = State.nivelSelecionado;
        this.els.reportNivel.textContent = nivel ? `Nível ${nivel}` : '—';
        this.els.reportNivel.className = `value classification ${nivel || ''}`;
        this.els.reportDataHora.textContent = new Date().toLocaleString('pt-BR');
        this.atualizarObservacoes();
    },

    limpar() {
        this.els.equipamento.value = '';
        this.els.endereco.value = '';
        this.els.pressao.value = '';
        this.els.obs.value = '';
        document.querySelectorAll('input[name="tipoManutencao"]').forEach(el => { el.checked = false; });
        document.querySelectorAll('.nivel-btn').forEach(b => b.classList.remove('selected'));
        State.nivelSelecionado = '';
        this.atualizarPressaoDestaque();
        this.atualizarObservacoes();
        if (!State.dadosProcessados) this.els.reportHeader.hidden = true;
        else this.atualizarCabecalho();
    }
};

/* ----------------------------------------------------------------
 * CANVAS CHART — picos coloridos por magnitude + estabilidades verdes
 * ---------------------------------------------------------------- */
const CanvasChart = {
    PAD: { top: 30, right: 30, bottom: 60, left: 70 },
    COLORS: {
        line: '#6caddc',
        lineFill: 'rgba(108,173,220,0.12)',
        grid: '#e2e8f0',
        axis: '#cbd5e1',
        text: '#5a6e7e',
        textTitle: '#7a8e9e',
        stable: '#1a6e4a',
        stableBorder: '#0a3e2a'
    },

    canvas: null, ctx: null, tooltip: null,
    _boundMove: null, _boundLeave: null, _last: null,

    init() {
        this.canvas = document.getElementById('pressureChart');
        this.ctx = this.canvas.getContext('2d');
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'chart-tooltip';
        this.tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(this.tooltip);

        this._boundMove = (e) => this._onMouseMove(e);
        this._boundLeave = () => this._hideTooltip();
        this.canvas.addEventListener('mousemove', this._boundMove);
        this.canvas.addEventListener('mouseleave', this._boundLeave);
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length) this._onMouseMove(e.touches[0]);
        }, { passive: true });
        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length) this._onMouseMove(e.touches[0]);
        }, { passive: true });
        this.canvas.addEventListener('touchend', this._boundLeave);
    },

    _fitCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = Math.max(300, rect.width);
        const cssH = Math.max(200, rect.height || 450);
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w: cssW, h: cssH };
    },

    render(times, lineData, peaks, stables, refValue) {
        if (!this.canvas || !times.length) return;
        const { w, h } = this._fitCanvas();
        const { PAD, COLORS } = this;
        const plotW = w - PAD.left - PAD.right;
        const plotH = h - PAD.top - PAD.bottom;

        this.ctx.clearRect(0, 0, w, h);

        const vals = lineData.filter(Number.isFinite);
        let minY = Math.min(...vals);
        let maxY = Math.max(...vals);
        const range = Math.max(maxY - minY, 0.001);
        const margin = range * 0.1;
        minY = Math.max(0, minY - margin);
        maxY = maxY + margin;

        const xOf = (i) => PAD.left + (i / (lineData.length - 1)) * plotW;
        const yOf = (v) => PAD.top + plotH - ((v - minY) / (maxY - minY)) * plotH;

        // Grade
        this.ctx.font = '11px "Segoe UI", sans-serif';
        this.ctx.fillStyle = COLORS.text;
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;
        for (let s = 0; s <= 5; s++) {
            const v = minY + ((maxY - minY) * s) / 5;
            const y = yOf(v);
            this.ctx.beginPath();
            this.ctx.moveTo(PAD.left, y);
            this.ctx.lineTo(PAD.left + plotW, y);
            this.ctx.stroke();
            this.ctx.textAlign = 'right';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(v.toFixed(3), PAD.left - 8, y);
        }

        // Eixos
        this.ctx.strokeStyle = COLORS.axis;
        this.ctx.beginPath();
        this.ctx.moveTo(PAD.left, PAD.top);
        this.ctx.lineTo(PAD.left, PAD.top + plotH);
        this.ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
        this.ctx.stroke();

        // Labels X
        const step = Math.max(1, Math.ceil(lineData.length / 10));
        this.ctx.fillStyle = COLORS.text;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        for (let i = 0; i < lineData.length; i += step) {
            this.ctx.fillText(Utils.extractTimeOnly(times[i]), xOf(i), PAD.top + plotH + 8);
        }

        // Título Y
        this.ctx.save();
        this.ctx.translate(18, PAD.top + plotH / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillStyle = COLORS.textTitle;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = '12px "Segoe UI", sans-serif';
        this.ctx.fillText('Pressão (Bar)', 0, 0);
        this.ctx.restore();

        // Linha + fill
        this.ctx.beginPath();
        for (let i = 0; i < lineData.length; i++) {
            const x = xOf(i), y = yOf(lineData[i]);
            if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
        }
        this.ctx.lineTo(xOf(lineData.length - 1), PAD.top + plotH);
        this.ctx.lineTo(xOf(0), PAD.top + plotH);
        this.ctx.closePath();
        this.ctx.fillStyle = COLORS.lineFill;
        this.ctx.fill();

        this.ctx.beginPath();
        for (let i = 0; i < lineData.length; i++) {
            const x = xOf(i), y = yOf(lineData[i]);
            if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
        }
        this.ctx.strokeStyle = COLORS.line;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // === MARCADORES ===
        // 1) Picos coloridos por magnitude
        for (const p of peaks) {
            const cor = PEAK_COLORS.classificacao(p.variacaoPercentual);
            this._drawCircle(xOf(p.index), yOf(p.value), cor.fill, cor.border, 7);
        }

        // 2) Estabilidades — losango verde-escuro, sempre por cima
        for (const s of stables) {
            this._drawDiamond(xOf(s.index), yOf(s.value), COLORS.stable, COLORS.stableBorder, 7);
        }

        this._last = { times, lineData, peaks, stables, xOf, PAD, plotW, plotH, refValue };
    },

    _drawCircle(x, y, fill, border, size) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    },

    _drawDiamond(x, y, fill, border, size) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    },

    _onMouseMove(evt) {
        if (!this._last) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const { times, lineData, peaks, stables, xOf, PAD, plotW, plotH, refValue } = this._last;
        if (x < PAD.left || x > PAD.left + plotW) return this._hideTooltip();
        if (y < PAD.top || y > PAD.top + plotH) return this._hideTooltip();

        let closest = 0, minDist = Infinity;
        for (let i = 0; i < lineData.length; i++) {
            const d = Math.abs(xOf(i) - x);
            if (d < minDist) { minDist = d; closest = i; }
        }

        const diff = Utils.calcularDiferencaPercentual(lineData[closest], refValue);
        const sinal = diff >= 0 ? '+' : '';

        let extra = '';
        const isPeak = peaks.find(p => p.index === closest);
        const isStable = stables.find(s => s.index === closest);
        if (isStable) extra = '\n🟢 Início de estabilidade';
        else if (isPeak) {
            const cor = PEAK_COLORS.classificacao(isPeak.variacaoPercentual);
            extra = `\n🔴 Pico ${cor.label}`;
        }

        const texto =
            `Pressão: ${lineData[closest].toFixed(4)} Bar\n` +
            `⏱️ ${times[closest]}\n` +
            `📊 Diferença: ${sinal}${diff.toFixed(2)}%` + extra;
        this._showTooltip(evt.clientX, evt.clientY, texto);
    },

    _showTooltip(clientX, clientY, texto) {
        this.tooltip.textContent = texto;
        this.tooltip.style.left = clientX + 'px';
        this.tooltip.style.top = (clientY - 10) + 'px';
        this.tooltip.classList.add('visible');
    },

    _hideTooltip() { this.tooltip.classList.remove('visible'); },

    recriar() {
        if (!State.currentChartData) return;
        if (document.getElementById('chartContainer').hidden) return;
        const ref = Utils.getPressaoReferencia();
        this.render(
            State.currentChartData.times,
            State.currentChartData.lineData,
            State.currentPeaks,
            State.currentStablePoints,
            ref
        );
    },

    destruir() {
        if (!this.canvas) return;
        const { w, h } = this._fitCanvas();
        this.ctx.clearRect(0, 0, w, h);
        this._last = null;
        this._hideTooltip();
    }
};

/* ----------------------------------------------------------------
 * TABELAS
 * ---------------------------------------------------------------- */
const Tabela = {
    /* --------------------------------------------------------------
     * RESUMO DE PICOS POR FAIXA
     * -------------------------------------------------------------- */
    renderPicos(peaks, times) {
        const badge = document.getElementById('picosCountBadge');
        const container = document.getElementById('picosTableContainer');
        const tableDiv = document.getElementById('picosTable');

        badge.textContent = `${peaks.length} pico${peaks.length !== 1 ? 's' : ''}`;
        container.hidden = false;

        if (peaks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '⚠️ Nenhum pico detectado nos dados analisados.';
            tableDiv.replaceChildren(empty);
            return;
        }

        const pressaoRef = Utils.getPressaoReferencia();

        // ---- Agrupa picos por faixa ----
        const faixas = new Map();

        for (const pico of peaks) {
            const diff = Utils.calcularDiferencaPercentual(pico.value, pressaoRef);
            const cor = PEAK_COLORS.classificacao(diff);
            const chave = cor.label;

            if (!faixas.has(chave)) {
                faixas.set(chave, {
                    cor,
                    count: 0,
                    minPct: Math.abs(diff),
                    maxPct: Math.abs(diff)
                });
            }
            const f = faixas.get(chave);
            f.count++;
            const abs = Math.abs(diff);
            f.minPct = Math.min(f.minPct, abs);
            f.maxPct = Math.max(f.maxPct, abs);
        }

        // ---- Ordena por faixa crescente ----
        const ordemFaixas = ['5-9%', '≥ 10%', '≥ 20%', '≥ 30%', '≥ 35%', '≥ 40%', '≥ 50%', '≥ 60%', '≥ 80%'];
        const faixasOrdenadas = ordemFaixas
            .filter(label => faixas.has(label))
            .map(label => ({ label, ...faixas.get(label) }));

        const total = peaks.length;

        // ---- Faixa mais comum ----
        let maisComum = faixasOrdenadas[0];
        for (const f of faixasOrdenadas) {
            if (f.count > maisComum.count) maisComum = f;
        }

        // ---- Constrói wrapper ----
        const wrapper = document.createElement('div');

        // Destaque
        const destaque = document.createElement('div');
        destaque.className = 'picos-destaque';

        destaque.appendChild(this._buildDestaque('Total de picos', String(total)));
        destaque.appendChild(this._buildDestaque(
            'Faixa mais comum',
            `${maisComum.label} (${maisComum.count}x)`,
            'cor-comum'
        ));
        destaque.appendChild(this._buildDestaque('Faixas atingidas', String(faixasOrdenadas.length)));
        wrapper.appendChild(destaque);

        // Subtítulo
        const sub = document.createElement('p');
        sub.className = 'picos-subtitulo';
        sub.textContent = 'Contagem de picos agrupados por magnitude (percentual acima da pressão de trabalho).';
        wrapper.appendChild(sub);

        // Tabela
        const table = document.createElement('table');
        table.className = 'picos-resumo';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['Faixa', 'Quantidade', '% do total', 'Distribuição']) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        for (const f of faixasOrdenadas) {
            const tr = document.createElement('tr');

            // Faixa com bolinha colorida
            const tdFaixa = document.createElement('td');

            const dot = document.createElement('span');
            dot.className = 'picos-dot ' + this._classeCorPorLabel(f.label);

            tdFaixa.appendChild(dot);
            tdFaixa.appendChild(document.createTextNode(f.label));
            tr.appendChild(tdFaixa);

            // Quantidade
            const tdQtd = document.createElement('td');
            tdQtd.className = 'col-center';
            const strongQtd = document.createElement('strong');
            strongQtd.textContent = String(f.count);
            tdQtd.appendChild(strongQtd);
            tr.appendChild(tdQtd);

            // % do total
            const pct = (f.count / total) * 100;
            const tdPct = document.createElement('td');
            tdPct.className = 'col-center';
            tdPct.textContent = `${pct.toFixed(1)}%`;
            tr.appendChild(tdPct);

            // Barra visual — largura via classe pré-definida
            const tdBarr = document.createElement('td');
            tdBarr.className = 'col-barra';
            const barra = document.createElement('div');
            barra.className = 'picos-barra ' + this._classeCorBarraPorLabel(f.label) + ' ' + this._classeLargura(pct);
            tdBarr.appendChild(barra);
            tr.appendChild(tdBarr);

            tbody.appendChild(tr);
        }

        // Linha de total
        const trTotal = document.createElement('tr');
        trTotal.className = 'row-total';

        const tdTotal = document.createElement('td');
        const strongTotal = document.createElement('strong');
        strongTotal.textContent = 'TOTAL';
        tdTotal.appendChild(strongTotal);
        trTotal.appendChild(tdTotal);

        const tdQtdTotal = document.createElement('td');
        tdQtdTotal.className = 'col-center';
        const strongQtdT = document.createElement('strong');
        strongQtdT.textContent = String(total);
        tdQtdTotal.appendChild(strongQtdT);
        trTotal.appendChild(tdQtdTotal);

        const tdPctTotal = document.createElement('td');
        tdPctTotal.className = 'col-center';
        const strongPctT = document.createElement('strong');
        strongPctT.textContent = '100.0%';
        tdPctTotal.appendChild(strongPctT);
        trTotal.appendChild(tdPctTotal);

        trTotal.appendChild(document.createElement('td'));
        tbody.appendChild(trTotal);

        table.appendChild(tbody);
        wrapper.appendChild(table);

        tableDiv.replaceChildren(wrapper);
    },

    /* -------- helpers internos para CSP-safe -------- */
    _buildDestaque(label, valor, classeExtra) {
        const item = document.createElement('div');
        item.className = 'picos-destaque-item';

        const l = document.createElement('span');
        l.className = 'picos-destaque-label';
        l.textContent = label;

        const v = document.createElement('span');
        v.className = 'picos-destaque-valor' + (classeExtra ? ' ' + classeExtra : '');
        v.textContent = valor;

        item.append(l, v);
        return item;
    },

    _classeCorPorLabel(label) {
        return {
            '5-9%':  'dot-5',
            '≥ 10%': 'dot-10',
            '≥ 20%': 'dot-20',
            '≥ 30%': 'dot-30',
            '≥ 35%': 'dot-35',
            '≥ 40%': 'dot-40',
            '≥ 50%': 'dot-50',
            '≥ 60%': 'dot-60',
            '≥ 80%': 'dot-80'
        }[label] || 'dot-5';
    },

    _classeCorBarraPorLabel(label) {
        return {
            '5-9%':  'bar-5',
            '≥ 10%': 'bar-10',
            '≥ 20%': 'bar-20',
            '≥ 30%': 'bar-30',
            '≥ 35%': 'bar-35',
            '≥ 40%': 'bar-40',
            '≥ 50%': 'bar-50',
            '≥ 60%': 'bar-60',
            '≥ 80%': 'bar-80'
        }[label] || 'bar-5';
    },

    /**
     * Converte um percentual (0-100) em uma classe tipo "w-42".
     * O CSS precisa ter .w-0 até .w-100.
     */
    _classeLargura(pct) {
        const n = Math.max(0, Math.min(100, Math.round(pct)));
        return 'w-' + n;
    },

    /* --------------------------------------------------------------
     * ESTABILIDADES
     * -------------------------------------------------------------- */
    renderStabilidades(points) {
        const badge = document.getElementById('estabCountBadge');
        const container = document.getElementById('estabTableContainer');
        const tableDiv = document.getElementById('estabTable');

        if (!container || !tableDiv) return;

        const inicios = points.filter(p => p.papel !== 'fim');
        const total = inicios.length;

        badge.textContent = `${total} estabilidade${total !== 1 ? 's' : ''}`;
        container.hidden = false;

        if (total === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '⚠️ Nenhum período estável (>3 min) detectado.';
            tableDiv.replaceChildren(empty);
            return;
        }

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['#', 'Início', 'Fim', 'Duração', 'Pressão (Bar)']) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        inicios.forEach((p, idx) => {
            const tr = document.createElement('tr');
            const cells = [
                { text: String(idx + 1), strong: true },
                { text: Utils.extractTimeOnly(p.time) },
                { text: Utils.extractTimeOnly(p.timeFim) },
                { text: Utils.formatDuracao(p.duracaoSegundos) },
                { text: p.value.toFixed(4) }
            ];
            for (const c of cells) {
                const td = document.createElement('td');
                if (c.strong) {
                    const s = document.createElement('strong');
                    s.textContent = c.text;
                    td.appendChild(s);
                } else {
                    td.textContent = c.text;
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableDiv.replaceChildren(table);
    },

    /* --------------------------------------------------------------
     * ESTATÍSTICAS
     * -------------------------------------------------------------- */
    renderStats(pressures, peaks, stables) {
        const maxP = Math.max(...pressures);
        const minP = Math.min(...pressures);
        const avgP = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        const pressaoRef = Utils.getPressaoReferencia();

        const totalEstab = stables.filter(s => s.papel !== 'fim').length;

        const stats = [
            { value: maxP.toFixed(3), label: 'Máxima Geral' },
            { value: minP.toFixed(3), label: 'Mínima Geral' },
            { value: avgP.toFixed(3), label: 'Média' },
            { value: pressaoRef.toFixed(3), label: 'Referência' },
            { value: peaks.length, label: 'Total Picos' },
            { value: totalEstab, label: 'Estabilidades' }
        ];

        const row = document.getElementById('statsRow');
        const frag = document.createDocumentFragment();
        for (const s of stats) {
            const box = document.createElement('div');
            box.className = 'stat-box';
            const val = document.createElement('div');
            val.className = 'stat-value';
            val.textContent = String(s.value);
            const lbl = document.createElement('div');
            lbl.className = 'stat-label';
            lbl.textContent = s.label;
            box.append(val, lbl);
            frag.appendChild(box);
        }
        row.replaceChildren(frag);
        row.hidden = false;
    }
};

/* ----------------------------------------------------------------
 * PROCESSADOR
 * ---------------------------------------------------------------- */
const Processador = {
    MAX_FILE_SIZE: 50 * 1024 * 1024,

    processarTexto(text) {
        this._esconderErro();

        // 1. Valida a pressão de referência ANTES de tudo
        const pressaoRef = Utils.getPressaoReferencia();
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) {
            this._erro('⚠️ Informe a Pressão de Trabalho (100%) antes de carregar o CSV.');
            document.getElementById('pressaoTrabalho').focus();
            return;
        }

        // 2. Agora sim, limpa os dados da análise anterior
        App.limparDados();

        // 3. Valida o texto
        if (!text || typeof text !== 'string') {
            this._erro('Arquivo vazio ou inválido.');
            return;
        }

        // 4. Parse do CSV
        let rows;
        try { rows = CSVParser.parse(text); }
        catch (err) { this._erro('Erro ao analisar CSV: ' + err.message); return; }

        if (!Array.isArray(rows) || rows.length < 2) {
            this._erro('Arquivo vazio ou com poucos dados');
            return;
        }

        const firstRow = rows[0];
        const firstPressure = firstRow.length >= 2
            ? parseFloat(String(firstRow[1]).replace(',', '.').trim())
            : NaN;
        const startIndex = Number.isFinite(firstPressure) ? 0 : 1;

        const times = [];
        const pressures = [];

        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) continue;
            const timeStr = row[0] != null ? String(row[0]).trim() : '';
            const pressStr = row[1] != null ? String(row[1]).replace(',', '.').trim() : '';
            const press = parseFloat(pressStr);
            if (timeStr !== '' && Number.isFinite(press)) {
                times.push(timeStr);
                pressures.push(press);
            }
        }

        if (times.length === 0) {
            this._erro('Não foi possível encontrar dados. Verifique o formato do CSV.');
            return;
        }

        // 5. Detecção
        State.rawTimes = times;
        State.rawPressures = pressures;
        State.currentPeaks = Detector.detectPeaks(pressures, pressaoRef);
        State.currentStablePoints = Detector.detectStabilityStarts(pressures, times, pressaoRef);

        // 6. Renderização
        Tabela.renderPicos(State.currentPeaks, times);
        Tabela.renderStabilidades(State.currentStablePoints);
        Tabela.renderStats(pressures, State.currentPeaks, State.currentStablePoints);

        State.currentChartData = {
            times: [...times],
            lineData: [...pressures]
        };

        document.getElementById('chartContainer').hidden = false;
        CanvasChart.render(
            times,
            pressures,
            State.currentPeaks,
            State.currentStablePoints,
            pressaoRef
        );
        this._updateLegend(times);

        State.dadosProcessados = true;
        Relatorio.atualizarCabecalho();
        document.getElementById('reportHeader').hidden = false;

        if (document.querySelectorAll('.responsavel-card').length === 0) {
            Responsaveis.adicionar();
        }

        const fileInfo = document.getElementById('fileInfo');
        fileInfo.textContent += ` — ${times.length.toLocaleString('pt-BR')} medições processadas`;
    },

    _updateLegend(times) {
        if (!times.length) return;
        const primeiro = times[0];
        const ultimo = times[times.length - 1];
        const dataInicio = primeiro.split(' ')[0] || primeiro;
        const dataFim = ultimo.split(' ')[0] || ultimo;
        document.getElementById('periodoInicio').textContent =
            `${dataInicio} ${Utils.extractTimeOnly(primeiro)}`;
        document.getElementById('periodoFim').textContent =
            `${dataFim} ${Utils.extractTimeOnly(ultimo)}`;
        document.getElementById('chartLegend').hidden = false;
    },

    _erro(msg) {
        const el = document.getElementById('errorMsg');
        el.textContent = msg;
        el.hidden = false;
        document.getElementById('chartContainer').hidden = true;
        document.getElementById('chartLegend').hidden = true;
        document.getElementById('picosTableContainer').hidden = true;
        const e = document.getElementById('estabTableContainer');
        if (e) e.hidden = true;
        document.getElementById('statsRow').hidden = true;
        State.dadosProcessados = false;
    },

    _esconderErro() {
        document.getElementById('errorMsg').hidden = true;
    }
};

/* ----------------------------------------------------------------
 * APP
 * ---------------------------------------------------------------- */
const App = {
    init() {
        Responsaveis.init();
        Logo.init();
        Relatorio.init();
        CanvasChart.init();
        this._bindUpload();
        this._bindAcoes();
        this._setupResize();
    },

    _bindUpload() {
        const input = document.getElementById('csvFile');
        const btn = document.getElementById('uploadLabelBtn');
        const fileInfo = document.getElementById('fileInfo');

        btn.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Bloqueia se pressão de referência estiver vazia
            const ref = Utils.getPressaoReferencia();
            if (!Number.isFinite(ref) || ref <= 0) {
                alert('⚠️ Informe a Pressão de Trabalho (100%) antes de carregar o CSV.');
                document.getElementById('pressaoTrabalho').focus();
                input.value = '';
                fileInfo.textContent = 'Nenhum arquivo selecionado';
                return;
            }

            if (file.size > Processador.MAX_FILE_SIZE) {
                alert('Arquivo muito grande! Limite: 50 MB.');
                input.value = '';
                fileInfo.textContent = 'Nenhum arquivo selecionado';
                return;
            }
            fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
            const reader = new FileReader();
            reader.onload = (ev) => Processador.processarTexto(String(ev.target.result || ''));
            reader.onerror = () => Processador._erro('Erro ao ler o arquivo.');
            reader.readAsText(file, 'UTF-8');
        });
    },

    _bindAcoes() {
        document.getElementById('btnLimparFormulario').addEventListener('click', () => {
            Relatorio.limpar();
            Responsaveis.grid.replaceChildren();
            State.nextResponsavelId = 1;
            Responsaveis.adicionar();
        });
        document.getElementById('btnLimparDados').addEventListener('click', () => this.limparDados());
        document.getElementById('btnImprimir').addEventListener('click', () => this.imprimir());
    },

    /* --------------------------------------------------------------
     * Reanalisa os dados já carregados com a nova referência
     * Chamado quando o usuário edita a pressão de trabalho
     * -------------------------------------------------------------- */
    reanalisar() {
        if (!State.rawPressures.length || !State.rawTimes.length) return;

        const pressaoRef = Utils.getPressaoReferencia();
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) {
            // Referência inválida: limpa o gráfico
            CanvasChart.destruir();
            document.getElementById('chartContainer').hidden = true;
            document.getElementById('chartLegend').hidden = true;
            document.getElementById('picosTableContainer').hidden = true;
            const e = document.getElementById('estabTableContainer');
            if (e) e.hidden = true;
            document.getElementById('statsRow').hidden = true;
            State.dadosProcessados = false;
            return;
        }

        const times = State.rawTimes;
        const pressures = State.rawPressures;

        // Reanalisa tudo com a nova referência
        State.currentPeaks = Detector.detectPeaks(pressures, pressaoRef);
        State.currentStablePoints = Detector.detectStabilityStarts(pressures, times, pressaoRef);

        Tabela.renderPicos(State.currentPeaks, times);
        Tabela.renderStabilidades(State.currentStablePoints);
        Tabela.renderStats(pressures, State.currentPeaks, State.currentStablePoints);

        State.currentChartData = {
            times: [...times],
            lineData: [...pressures]
        };

        document.getElementById('chartContainer').hidden = false;
        CanvasChart.render(
            times,
            pressures,
            State.currentPeaks,
            State.currentStablePoints,
            pressaoRef
        );

        State.dadosProcessados = true;
        Relatorio.atualizarCabecalho();
        document.getElementById('reportHeader').hidden = false;
    },



    limparDados() {
        CanvasChart.destruir();
        document.getElementById('chartContainer').hidden = true;
        document.getElementById('chartLegend').hidden = true;
        document.getElementById('picosTableContainer').hidden = true;
        const e = document.getElementById('estabTableContainer');
        if (e) e.hidden = true;
        document.getElementById('statsRow').hidden = true;
        document.getElementById('reportHeader').hidden = true;
        document.getElementById('fileInfo').textContent = 'Nenhum arquivo selecionado';
        document.getElementById('errorMsg').hidden = true;
        document.getElementById('csvFile').value = '';

        State.dadosProcessados = false;
        State.rawTimes = [];
        State.rawPressures = [];
        State.currentChartData = null;
        State.currentPeaks = [];
        State.currentStablePoints = [];
    },

    imprimir() {
        if (!State.dadosProcessados) {
            alert('Carregue um arquivo CSV primeiro!');
            return;
        }
        const ref = Utils.getPressaoReferencia();
        if (!Number.isFinite(ref) || ref <= 0) {
            alert('⚠️ Informe a Pressão de Trabalho (100%) antes de imprimir.');
            document.getElementById('pressaoTrabalho').focus();
            return;
        }
        Relatorio.atualizarCabecalho();
        CanvasChart.recriar();
        setTimeout(() => window.print(), 200);
    },

    _setupResize() {
        const debounced = () => {
            if (State.resizeTimeout) clearTimeout(State.resizeTimeout);
            State.resizeTimeout = setTimeout(() => CanvasChart.recriar(), 150);
        };
        if (State.resizeObserver) State.resizeObserver.disconnect();
        State.resizeObserver = new ResizeObserver(debounced);
        const container = document.getElementById('chartContainer');
        if (container) State.resizeObserver.observe(container);
        window.addEventListener('resize', debounced);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());

/* ----------------------------------------------------------------
 * PWA — Registra o Service Worker para funcionamento offline
 * ---------------------------------------------------------------- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('./service-worker.js')
            .then((reg) => {
                console.log('[PWA] Service Worker registrado:', reg.scope);

                // Verifica se há atualização disponível
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // Há uma nova versão em cache — avisa o usuário
                            const msg = 'Nova versão disponível. Recarregar agora?';
                            if (confirm(msg)) {
                                newWorker.postMessage('SKIP_WAITING');
                                window.location.reload();
                            }
                        }
                    });
                });
            })
            .catch((err) => {
                console.warn('[PWA] Falha ao registrar SW:', err);
            });
    });
}