'use strict';

/* ================================================================
 * DATA LOGGER - ANÁLISE DE PRESSÃO
 * Zero dependências externas. CSP-safe.
 *
 * ================================================================
 * MÉTRICA: análise por FAIXAS PERCENTUAIS
 * ================================================================
 * A pressão de trabalho = 100%. Zero absoluto = 0%.
 *
 *   - Cada faixa representa um percentual da pressão de trabalho
 *   - Linhas horizontais tracejadas no gráfico marcam cada faixa
 *   - Análise conta: quantas vezes cada faixa foi atingida e por
 *     quanto tempo a curva permaneceu acima/abaixo dela
 *   - Sem marcadores de pico: apenas linhas de referência
 *
 * ================================================================
 * PERSISTÊNCIA
 * ================================================================
 * Logo, responsáveis e pressão de trabalho são salvos em
 * localStorage e restaurados na próxima sessão.
 *
 * ================================================================
 * IMPRESSÃO DE ALTA RESOLUÇÃO
 * ================================================================
 * Ao imprimir, o gráfico é redesenhado com DPR forçado (2.5x) para
 * sair nítido no papel/PDF.
 *
 * ================================================================
 */

const CONFIG = {
    FAIXAS_PCT: [-5, 0, 5, 10, 80, 85, 90, 95, 100, 105, 110, 115,
                 120, 125, 130, 135, 140, 150, 160, 170, 180],
    MIN_PRESSAO_PCT_REF: 2,
    LIMIAR_PRECISAO: 0.350,
    _sampleRate: 1
};

/* ----------------------------------------------------------------
 * PERSISTÊNCIA LOCAL (localStorage)
 * ---------------------------------------------------------------- */
const Storage = {
    KEY_LOGO: 'datalogger_logo',
    KEY_RESP: 'datalogger_responsaveis',
    KEY_PRESSAO: 'datalogger_pressao',

    _disponivel() {
        try {
            const t = '__test__';
            localStorage.setItem(t, t);
            localStorage.removeItem(t);
            return true;
        } catch (e) {
            return false;
        }
    },

    salvarLogo(dataURL) {
        if (!this._disponivel()) return;
        try {
            if (dataURL) localStorage.setItem(this.KEY_LOGO, dataURL);
            else localStorage.removeItem(this.KEY_LOGO);
        } catch (e) { console.warn('[Storage] Falha ao salvar logo:', e); }
    },

    carregarLogo() {
        if (!this._disponivel()) return null;
        try { return localStorage.getItem(this.KEY_LOGO) || null; }
        catch (e) { return null; }
    },

    salvarResponsaveis(lista) {
        if (!this._disponivel()) return;
        try {
            if (Array.isArray(lista) && lista.length > 0) {
                localStorage.setItem(this.KEY_RESP, JSON.stringify(lista));
            } else {
                localStorage.removeItem(this.KEY_RESP);
            }
        } catch (e) { console.warn('[Storage] Falha ao salvar responsáveis:', e); }
    },

    carregarResponsaveis() {
        if (!this._disponivel()) return [];
        try {
            const raw = localStorage.getItem(this.KEY_RESP);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { return []; }
    },

    salvarPressao(valor) {
        if (!this._disponivel()) return;
        try {
            if (Number.isFinite(valor) && valor > 0) {
                localStorage.setItem(this.KEY_PRESSAO, String(valor));
            } else {
                localStorage.removeItem(this.KEY_PRESSAO);
            }
        } catch (e) { console.warn('[Storage] Falha ao salvar pressão:', e); }
    },

    carregarPressao() {
        if (!this._disponivel()) return null;
        try {
            const raw = localStorage.getItem(this.KEY_PRESSAO);
            if (!raw) return null;
            const v = parseFloat(raw);
            return Number.isFinite(v) && v > 0 ? v : null;
        } catch (e) { return null; }
    }
};

/* ----------------------------------------------------------------
 * ESTADO GLOBAL
 * ---------------------------------------------------------------- */
const State = {
    dadosProcessados: false,
    nivelSelecionado: '',
    rawTimes: [],
    rawPressures: [],
    logoDataURL: null,
    currentChartData: null,
    faixasResultado: [],
    amostragemSegundos: 1,
    resizeTimeout: null,
    resizeObserver: null,
    debug: false
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
        if (!el) return null;
        const valor = parseFloat(el.value);
        return Number.isFinite(valor) && valor > 0 ? valor : null;
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
        const h = Math.floor(s / 3600);
        const min = Math.floor((s % 3600) / 60);
        const resto = s % 60;
        if (h > 0) return `${h}h ${min}min ${resto}s`;
        return `${min}min ${resto}s`;
    },

    formatAmostragem(seg) {
        if (!Number.isFinite(seg) || seg <= 0) return '—';
        if (seg < 1) return `${seg.toFixed(2)} s/ponto`;
        return `${seg.toFixed(0)} s/ponto`;
    },

    formatPressao(valor, limiar = CONFIG.LIMIAR_PRECISAO) {
        if (!Number.isFinite(valor)) return '—';
        const abs = Math.abs(valor);
        return abs >= limiar ? valor.toFixed(2) : valor.toFixed(4);
    }
};

/* ----------------------------------------------------------------
 * PALETA DE CORES DAS FAIXAS
 * ---------------------------------------------------------------- */
const PALETA_FAIXAS = {
    '-5':  { fill: '#1a1a1a', border: '#000000' },
    '0':   { fill: '#2c2c2c', border: '#000000' },
    '5':   { fill: '#3a3a3a', border: '#000000' },
    '10':  { fill: '#4a4a4a', border: '#1a1a1a' },
    '80':  { fill: '#8b0000', border: '#5a0000' },
    '85':  { fill: '#a52a2a', border: '#6a1a1a' },
    '90':  { fill: '#c07070', border: '#8a4040' },
    '95':  { fill: '#e0a0a0', border: '#b06060' },
    '100': { fill: '#2c9e6e', border: '#1a6e4a' },
    '105': { fill: '#4ab88a', border: '#2a8060' },
    '110': { fill: '#a8c840', border: '#7a9e20' },
    '115': { fill: '#f9c022', border: '#b8860b' },
    '120': { fill: '#f0a030', border: '#c07020' },
    '125': { fill: '#e67e22', border: '#a04000' },
    '130': { fill: '#e06020', border: '#a04010' },
    '135': { fill: '#cc4a1a', border: '#8a3010' },
    '140': { fill: '#b83030', border: '#8a1010' },
    '150': { fill: '#8e44ad', border: '#5b2c6f' },
    '160': { fill: '#5b2c8f', border: '#3a1a5f' },
    '170': { fill: '#3a1a5f', border: '#200f40' },
    '180': { fill: '#e91e63', border: '#ad1457' }
};

/* ----------------------------------------------------------------
 * PARSER CSV
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
 * ANALISADOR DE FAIXAS
 * ---------------------------------------------------------------- */
const AnalisadorFaixas = {
    analisar(times, pressures, pressaoRef) {
        if (!Array.isArray(pressures) || pressures.length < 2) return [];
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) return [];

        const faixas = CONFIG.FAIXAS_PCT;
        const result = [];

        const temposSeg = times.map(t => Utils.parseTimeToSeconds(t));
        const amostragemPadrao = CONFIG._sampleRate || 1;

        const duracoes = new Array(pressures.length).fill(amostragemPadrao);
        for (let i = 1; i < pressures.length; i++) {
            const t1 = temposSeg[i - 1];
            const t2 = temposSeg[i];
            if (Number.isFinite(t1) && Number.isFinite(t2) && t2 >= t1) {
                let d = t2 - t1;
                if (d < 0) d += 24 * 3600;
                if (d > 0 && d <= 600) duracoes[i] = d;
            }
        }

        for (const pct of faixas) {
            const valorLimite = pressaoRef * (pct / 100);

            let ocorrencias = 0;
            let tempoTotalSeg = 0;
            let dentro = false;

            for (let i = 0; i < pressures.length; i++) {
                const valor = Number(pressures[i]);
                if (!Number.isFinite(valor)) continue;

                const estaDentro = this._estaNaFaixa(valor, valorLimite, pct);

                if (estaDentro && !dentro) {
                    ocorrencias++;
                    dentro = true;
                } else if (!estaDentro && dentro) {
                    dentro = false;
                }

                if (estaDentro) {
                    const dur = (i === 0) ? amostragemPadrao : duracoes[i];
                    if (Number.isFinite(dur)) tempoTotalSeg += dur;
                }
            }

            result.push({
                pct,
                valorBar: valorLimite,
                ocorrencias,
                tempoTotalSeg
            });
        }

        return result;
    },

    _estaNaFaixa(valor, valorLimite, pct) {
        if (pct < 100) return valor <= valorLimite;
        return valor >= valorLimite;
    }
};

/* ----------------------------------------------------------------
 * RESPONSÁVEIS
 * ---------------------------------------------------------------- */
const Responsaveis = {
    grid: null, reportGrid: null, reportSection: null,
    _debTimer: null,

    init() {
        this.grid = document.getElementById('responsaveisGrid');
        this.reportGrid = document.getElementById('responsaveisReportGrid');
        this.reportSection = document.getElementById('responsaveisReport');

        document.getElementById('btnAddResponsavel')
            .addEventListener('click', () => {
                this.adicionar();
                this._persistir();
            });

        this.grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-responsavel');
            if (!btn) return;
            const card = btn.closest('.responsavel-card');
            if (card) {
                card.remove();
                this.atualizarRelatorio();
                this._persistir();
            }
        });

        this.grid.addEventListener('input', () => {
            this.atualizarRelatorio();
            this._persistirDebounced();
        });

        const salvos = Storage.carregarResponsaveis();
        if (salvos.length > 0) {
            for (const r of salvos) this.adicionar(r);
        } else {
            this.adicionar();
        }
    },

    adicionar(dadosIniciais) {
        const card = document.createElement('div');
        card.className = 'responsavel-card';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-remove-responsavel';
        btn.textContent = 'Remover';

        const row = document.createElement('div');
        row.className = 'responsavel-row';

        const fields = [
            { cls: 'resp-nome', placeholder: 'Nome completo', valor: (dadosIniciais && dadosIniciais.nome) || '' },
            { cls: 'resp-cargo', placeholder: 'Cargo / Função', valor: (dadosIniciais && dadosIniciais.cargo) || '' },
            { cls: 'resp-registro', placeholder: 'Registro / Matrícula', valor: (dadosIniciais && dadosIniciais.registro) || '' }
        ];

        for (const f of fields) {
            const wrap = document.createElement('div');
            wrap.className = 'responsavel-field';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = f.cls;
            input.placeholder = f.placeholder;
            input.value = f.valor;
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
    },

    _persistir() {
        Storage.salvarResponsaveis(this.coletar());
    },

    _persistirDebounced() {
        if (this._debTimer) clearTimeout(this._debTimer);
        this._debTimer = setTimeout(() => this._persistir(), 400);
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
            Storage.salvarLogo(null);
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
            reader.onload = (ev) => {
                State.logoDataURL = ev.target.result;
                Storage.salvarLogo(State.logoDataURL);
                this.render();
            };
            reader.onerror = () => alert('Erro ao ler a imagem.');
            reader.readAsDataURL(file);
        });

        const logoSalvo = Storage.carregarLogo();
        if (logoSalvo) State.logoDataURL = logoSalvo;

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
    _pressaoTimer: null,

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
            reportAmostragem: document.getElementById('reportAmostragem'),
            reportClass: document.getElementById('reportClassificacao'),
            reportNivel: document.getElementById('reportNivel'),
            reportDataHora: document.getElementById('reportDataHora'),
            reportHeader: document.getElementById('reportHeader')
        };

        this.els.obs.addEventListener('input', () => this.atualizarObservacoes());

        [this.els.equipamento, this.els.endereco].forEach(el => {
            el.addEventListener('input', () => this.atualizarCabecalho());
        });

        this.els.pressao.addEventListener('input', () => {
            this.atualizarPressaoDestaque();
            this.atualizarCabecalho();

            if (this._pressaoTimer) clearTimeout(this._pressaoTimer);
            this._pressaoTimer = setTimeout(() => {
                const v = parseFloat(this.els.pressao.value);
                Storage.salvarPressao(Number.isFinite(v) && v > 0 ? v : null);
            }, 400);

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

        const pressaoSalva = Storage.carregarPressao();
        if (pressaoSalva !== null) {
            this.els.pressao.value = String(pressaoSalva);
            this.atualizarPressaoDestaque();
            this.atualizarCabecalho();
        }
    },

    atualizarPressaoDestaque() {
        const valor = parseFloat(this.els.pressao.value);
        const valido = Number.isFinite(valor) && valor > 0;
        this.els.pressao.classList.toggle('input-invalid', !valido);
        this.els.pressaoDestaque.textContent = valido
            ? `${Utils.formatPressao(valor)} Bar`
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

        const pv = parseFloat(this.els.pressao.value);
        this.els.reportPressao.textContent = Number.isFinite(pv) && pv > 0
            ? `${Utils.formatPressao(pv)} Bar` : '—';

        if (this.els.reportAmostragem) {
            this.els.reportAmostragem.textContent =
                State.dadosProcessados
                    ? Utils.formatAmostragem(State.amostragemSegundos)
                    : '—';
        }

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
        // Pressão NÃO é limpa: fica persistida no localStorage
        this.els.obs.value = '';

        document.querySelectorAll('input[name="tipoManutencao"]').forEach(el => { el.checked = false; });
        document.querySelectorAll('.nivel-btn').forEach(b => b.classList.remove('selected'));

        State.nivelSelecionado = '';
        if (!State.dadosProcessados) State.amostragemSegundos = 1;

        this.atualizarPressaoDestaque();
        this.atualizarObservacoes();

        if (!State.dadosProcessados) this.els.reportHeader.hidden = true;
        else this.atualizarCabecalho();
    }
};

/* ----------------------------------------------------------------
 * CANVAS CHART
 * ---------------------------------------------------------------- */
const CanvasChart = {
    PAD: { top: 20, right: 60, bottom: 40, left: 70 },
    COLORS: {
        line: '#6caddc',
        lineFill: 'rgba(108,173,220,0.12)',
        grid: '#eef2f6',
        axis: '#cbd5e1',
        text: '#5a6e7e',
        textTitle: '#7a8e9e',
        textGrid: '#7a8e9e'
    },

    canvas: null, ctx: null, tooltip: null,
    _boundMove: null, _boundLeave: null, _last: null,

    init() {
        this.canvas = document.getElementById('pressureChart');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'chart-tooltip';
        this.tooltip.setAttribute('role', 'tooltip');
        this.tooltip.setAttribute('aria-label', 'Detalhes do ponto de pressão');
        this.tooltip.setAttribute('aria-live', 'polite');
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

    /**
     * Ajusta o canvas ao tamanho do container com DPR alto.
     * Retorna { w, h } em pixels lógicos (CSS).
     */
    _fitCanvas() {
        const dprReal = window.devicePixelRatio || 1;
        const dpr = Math.min(Math.max(dprReal, 2), 4);

        const container = this.canvas.parentElement;
        const rectContainer = container
            ? container.getBoundingClientRect()
            : this.canvas.getBoundingClientRect();

        const cssW = Math.max(400, Math.round(rectContainer.width - 30));
        const cssH = 700;

        const bitmapW = Math.round(cssW * dpr);
        const bitmapH = Math.round(cssH * dpr);

        if (this.canvas.width !== bitmapW || this.canvas.height !== bitmapH) {
            this.canvas.width = bitmapW;
            this.canvas.height = bitmapH;
        }

        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';

        const dprEfetivo = bitmapW / cssW;
        this.ctx.setTransform(dprEfetivo, 0, 0, dprEfetivo, 0, 0);

        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        return { w: cssW, h: cssH };
    },

    render(times, lineData, refValue) {
        if (!this.canvas || !times.length) return;
        if (!Array.isArray(lineData) || lineData.length < 2) return;
        if (!Number.isFinite(refValue) || refValue <= 0) return;

        const { w, h } = this._fitCanvas();
        this._renderInterno(times, lineData, refValue, w, h);
    },

    /**
     * Renderiza em alta resolução para impressão.
     * Usa dimensões fixas maiores + DPR 2.5.
     */
    renderParaImpressao(refValue) {
        if (!State.currentChartData || !this.canvas) return;
        if (!Number.isFinite(refValue) || refValue <= 0) return;

        const times = State.currentChartData.times;
        const lineData = State.currentChartData.lineData;

        const dprImpressao = 2.5;
        const cssW = 1100;
        const cssH = 420;

        this.canvas.width = Math.round(cssW * dprImpressao);
        this.canvas.height = Math.round(cssH * dprImpressao);
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';

        this.ctx.setTransform(dprImpressao, 0, 0, dprImpressao, 0, 0);
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this._renderInterno(times, lineData, refValue, cssW, cssH);
    },

    _renderInterno(times, lineData, refValue, w, h) {
        const { PAD, COLORS } = this;
        const dprEfetivo = this.canvas.width / (w || 1);
        const plotW = w - PAD.left - PAD.right;
        const plotH = h - PAD.top - PAD.bottom;

        this.ctx.clearRect(0, 0, w, h);

        const vals = lineData.filter(Number.isFinite);
        if (vals.length === 0) return;

        const yMax = refValue * 2;
        const yMin = 0;

        const xOf = (i) => PAD.left + (i / (lineData.length - 1)) * plotW;
        const yOf = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

        // ============================================================
        // 1. GRADE EM BAR (passo = 20% da referência)
        // ============================================================
        const passo = refValue * 0.2;
        let casas = 2;
        if (passo < 0.1) casas = 3;
        else if (passo >= 10) casas = 0;

        this.ctx.save();
        this.ctx.font = '11px "Segoe UI", sans-serif';
        this.ctx.textAlign = 'right';
        this.ctx.textBaseline = 'middle';
        this.ctx.setLineDash([]);
        this.ctx.strokeStyle = COLORS.grid;
        this.ctx.lineWidth = 1;

        for (let v = 0; v <= yMax + 0.0001; v += passo) {
            const valor = Math.round(v * 10000) / 10000;
            const y = Math.round(yOf(valor)) + 0.5;
            if (y < PAD.top - 1 || y > PAD.top + plotH + 1) continue;

            this.ctx.beginPath();
            this.ctx.moveTo(PAD.left, y);
            this.ctx.lineTo(PAD.left + plotW, y);
            this.ctx.stroke();

            this.ctx.fillStyle = COLORS.textGrid;
            this.ctx.fillText(valor.toFixed(casas), PAD.left - 8, y);
        }
        this.ctx.restore();

        // ============================================================
        // 2. LINHAS DAS FAIXAS PERCENTUAIS
        // ============================================================
        const faixas = CONFIG.FAIXAS_PCT;

        for (const pct of faixas) {
            const valor = refValue * (pct / 100);
            const y = Math.round(yOf(valor)) + 0.5;
            if (y < PAD.top - 5 || y > PAD.top + plotH + 5) continue;

            const cor = PALETA_FAIXAS[String(pct)] || { fill: '#999', border: '#666' };
            const ehReferencia = (pct === 100);
            const ehZero = (pct === 0);

            let lw = 1;
            if (ehReferencia) lw = 2;
            else if (ehZero) lw = 1.5;
            if (dprEfetivo >= 3 && !ehReferencia) lw = Math.max(lw, 1.2);

            this.ctx.save();
            this.ctx.strokeStyle = cor.fill;
            this.ctx.lineWidth = lw;
            this.ctx.setLineDash(ehReferencia ? [] : [5, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(PAD.left, y);
            this.ctx.lineTo(PAD.left + plotW, y);
            this.ctx.stroke();
            this.ctx.restore();

            this.ctx.font = ehReferencia
                ? 'bold 11px "Segoe UI", sans-serif'
                : '10px "Segoe UI", sans-serif';
            this.ctx.fillStyle = cor.fill;
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(`${pct}%`, PAD.left + plotW + 6, y);
        }

        // ============================================================
        // 3. EIXOS
        // ============================================================
        this.ctx.strokeStyle = COLORS.axis;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([]);
        this.ctx.beginPath();
        this.ctx.moveTo(Math.round(PAD.left) + 0.5, PAD.top);
        this.ctx.lineTo(Math.round(PAD.left) + 0.5, Math.round(PAD.top + plotH) + 0.5);
        this.ctx.lineTo(PAD.left + plotW, Math.round(PAD.top + plotH) + 0.5);
        this.ctx.stroke();

        // ============================================================
        // 4. LABELS X (tempo) — sem sobreposição
        // ============================================================
        this.ctx.fillStyle = COLORS.text;
        this.ctx.font = '11px "Segoe UI", sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';

        const larguraMinLabel = 60;
        const maxLabels = Math.max(2, Math.floor(plotW / larguraMinLabel));
        const step = Math.max(1, Math.ceil(lineData.length / maxLabels));

        for (let i = 0; i < lineData.length; i += step) {
            this.ctx.fillText(
                Utils.extractTimeOnly(times[i]),
                xOf(i),
                PAD.top + plotH + 8
            );
        }

        // ============================================================
        // 5. TÍTULO EIXO Y
        // ============================================================
        this.ctx.save();
        this.ctx.translate(18, PAD.top + plotH / 2);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillStyle = COLORS.textTitle;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = '12px "Segoe UI", sans-serif';
        this.ctx.fillText('Pressão (Bar)', 0, 0);
        this.ctx.restore();

        // ============================================================
        // 6. CURVA DE PRESSÃO
        // ============================================================
        // Fill
        this.ctx.beginPath();
        for (let i = 0; i < lineData.length; i++) {
            const v = Number(lineData[i]);
            if (!Number.isFinite(v)) continue;
            const x = xOf(i);
            const y = yOf(Math.max(yMin, Math.min(yMax, v)));
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        }
        this.ctx.lineTo(xOf(lineData.length - 1), PAD.top + plotH);
        this.ctx.lineTo(xOf(0), PAD.top + plotH);
        this.ctx.closePath();
        this.ctx.fillStyle = COLORS.lineFill;
        this.ctx.fill();

        // Linha
        this.ctx.beginPath();
        let primeiro = true;
        for (let i = 0; i < lineData.length; i++) {
            const v = Number(lineData[i]);
            if (!Number.isFinite(v)) {
                primeiro = true;
                continue;
            }
            const x = xOf(i);
            const y = yOf(Math.max(yMin, Math.min(yMax, v)));
            if (primeiro) {
                this.ctx.moveTo(x, y);
                primeiro = false;
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.strokeStyle = COLORS.line;
        this.ctx.lineWidth = (dprEfetivo >= 3) ? 2.2 : 2;
        this.ctx.setLineDash([]);
        this.ctx.stroke();

        this._last = {
            times, lineData, refValue,
            xOf, yOf, PAD, plotW, plotH,
            yMin, yMax
        };
    },

    _onMouseMove(evt) {
        if (!this._last) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const { times, lineData, xOf, PAD, plotW, plotH, refValue } = this._last;

        if (x < PAD.left || x > PAD.left + plotW) return this._hideTooltip();
        if (y < PAD.top || y > PAD.top + plotH) return this._hideTooltip();

        let closest = 0, minDist = Infinity;
        for (let i = 0; i < lineData.length; i++) {
            const d = Math.abs(xOf(i) - x);
            if (d < minDist) { minDist = d; closest = i; }
        }

        const valor = lineData[closest];
        const pct = (valor / refValue) * 100;

        const texto =
            `Pressão: ${Utils.formatPressao(valor)} Bar\n` +
            `⏱️ ${times[closest]}\n` +
            `📊 ${pct.toFixed(1)}% da pressão de trabalho`;

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
        if (!Number.isFinite(ref) || ref <= 0) return;

        // Restaura dimensões normais via _fitCanvas + render
        const { w, h } = this._fitCanvas();
        this._renderInterno(
            State.currentChartData.times,
            State.currentChartData.lineData,
            ref,
            w, h
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
 * TABELA — resumo de faixas atingidas
 * ---------------------------------------------------------------- */
const Tabela = {
    renderFaixas(faixasResultado, duracaoTotalSeg) {
        const container = document.getElementById('faixasTableContainer');
        const tableDiv = document.getElementById('faixasTable');
        const badge = document.getElementById('faixasCountBadge');

        if (!container || !tableDiv) return;

        if (!faixasResultado || faixasResultado.length === 0) {
            badge.textContent = '0 faixas';
            container.hidden = true;
            return;
        }

        const atingidas = faixasResultado.filter(f => f.ocorrencias > 0);
        badge.textContent = `${atingidas.length} faixa${atingidas.length !== 1 ? 's' : ''} atingida${atingidas.length !== 1 ? 's' : ''}`;

        if (atingidas.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = '⚠️ Nenhuma faixa foi atingida nos dados analisados.';
            tableDiv.replaceChildren(empty);
            container.hidden = false;
            return;
        }

        atingidas.sort((a, b) => b.pct - a.pct);

        const table = document.createElement('table');
        table.className = 'faixas-resumo';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['Faixa', 'Valor (Bar)', 'Ocorrências', 'Tempo total', '% do tempo']) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const f of atingidas) {
            const tr = document.createElement('tr');

            const tdFaixa = document.createElement('td');
            const cor = PALETA_FAIXAS[String(f.pct)] || { fill: '#999', border: '#666' };
            const dot = document.createElement('span');
            dot.className = 'faixa-dot';
            dot.style.background = cor.fill;
            dot.style.borderColor = cor.border;
            tdFaixa.appendChild(dot);
            tdFaixa.appendChild(document.createTextNode(`${f.pct}%`));
            tr.appendChild(tdFaixa);

            const tdValor = document.createElement('td');
            tdValor.textContent = Utils.formatPressao(f.valorBar);
            tr.appendChild(tdValor);

            const tdOcor = document.createElement('td');
            tdOcor.className = 'col-center';
            const strong = document.createElement('strong');
            strong.textContent = String(f.ocorrencias);
            tdOcor.appendChild(strong);
            tr.appendChild(tdOcor);

            const tdTempo = document.createElement('td');
            tdTempo.textContent = Utils.formatDuracao(f.tempoTotalSeg);
            tr.appendChild(tdTempo);

            const tdPct = document.createElement('td');
            tdPct.className = 'col-center';
            const pctTempo = duracaoTotalSeg > 0
                ? (f.tempoTotalSeg / duracaoTotalSeg) * 100
                : 0;
            tdPct.textContent = `${pctTempo.toFixed(1)}%`;
            tr.appendChild(tdPct);

            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        tableDiv.replaceChildren(table);
        container.hidden = false;
    },

    renderStats(pressures, faixasResultado) {
        if (!Array.isArray(pressures) || pressures.length === 0) return;

        const maxP = Math.max(...pressures);
        const minP = Math.min(...pressures);
        const avgP = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        const pressaoRef = Utils.getPressaoReferencia();

        let faixaMax = null;
        if (faixasResultado) {
            const atingidas = faixasResultado.filter(f => f.ocorrencias > 0);
            if (atingidas.length > 0) {
                faixaMax = atingidas.reduce((a, b) => a.pct > b.pct ? a : b);
            }
        }

        const stats = [
            { value: Utils.formatPressao(maxP), label: 'Máxima Geral' },
            { value: Utils.formatPressao(minP), label: 'Mínima Geral' },
            { value: Utils.formatPressao(avgP), label: 'Média' },
            { value: Utils.formatPressao(pressaoRef), label: 'Referência' },
            { value: faixaMax ? `${faixaMax.pct}%` : '—', label: 'Faixa Máx.' },
            { value: faixasResultado ? faixasResultado.filter(f => f.ocorrencias > 0).length : 0, label: 'Faixas Ating.' }
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

    _detectarAmostragem(times) {
        if (!Array.isArray(times) || times.length < 3) return 1;
        const TAXAS_CONHECIDAS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300];
        const N_MAX = Math.min(30, times.length - 1);
        const intervalos = [];

        for (let i = 1; i <= N_MAX; i++) {
            const t1 = Utils.parseTimeToSeconds(times[i - 1]);
            const t2 = Utils.parseTimeToSeconds(times[i]);
            if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;
            let diff = t2 - t1;
            if (diff < 0) diff += 24 * 3600;
            if (diff > 0 && diff <= 300) intervalos.push(diff);
        }

        if (intervalos.length === 0) return 1;

        intervalos.sort((a, b) => a - b);
        const meio = Math.floor(intervalos.length / 2);
        const mediana = intervalos.length % 2 === 0
            ? (intervalos[meio - 1] + intervalos[meio]) / 2
            : intervalos[meio];

        let melhorTaxa = 1, melhorDistancia = Infinity;
        for (const taxa of TAXAS_CONHECIDAS) {
            const distancia = Math.abs(taxa - mediana);
            if (distancia < melhorDistancia) {
                melhorDistancia = distancia;
                melhorTaxa = taxa;
            }
        }

        if (melhorDistancia / melhorTaxa > 0.4) {
            return Math.max(1, Math.round(mediana));
        }
        return melhorTaxa;
    },

    processarTexto(text) {
        this._esconderErro();

        const pressaoRef = Utils.getPressaoReferencia();
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) {
            this._erro('⚠️ Informe a Pressão de Trabalho (100%) antes de carregar o CSV.');
            document.getElementById('pressaoTrabalho').focus();
            return;
        }

        App.limparDados();

        if (!text || typeof text !== 'string') {
            this._erro('Arquivo vazio ou inválido.');
            return;
        }

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

        const amostragemSegundos = this._detectarAmostragem(times);
        CONFIG._sampleRate = amostragemSegundos;
        State.amostragemSegundos = amostragemSegundos;

        State.rawTimes = times;
        State.rawPressures = pressures;

        const faixasResultado = AnalisadorFaixas.analisar(times, pressures, pressaoRef);
        State.faixasResultado = faixasResultado;

        const t0 = Utils.parseTimeToSeconds(times[0]);
        const tN = Utils.parseTimeToSeconds(times[times.length - 1]);
        let duracaoTotalSeg = 0;
        if (Number.isFinite(t0) && Number.isFinite(tN)) {
            duracaoTotalSeg = tN - t0;
            if (duracaoTotalSeg < 0) duracaoTotalSeg += 24 * 3600;
        }

        Tabela.renderFaixas(faixasResultado, duracaoTotalSeg);
        Tabela.renderStats(pressures, faixasResultado);

        State.currentChartData = { times: [...times], lineData: [...pressures] };

        document.getElementById('chartContainer').hidden = false;
        CanvasChart.render(times, pressures, pressaoRef);
        this._updateLegend(times);

        State.dadosProcessados = true;
        Relatorio.atualizarCabecalho();
        document.getElementById('reportHeader').hidden = false;

        const fileInfo = document.getElementById('fileInfo');
        fileInfo.textContent = `${fileInfo.dataset.filename || 'arquivo'} — ${times.length.toLocaleString('pt-BR')} medições processadas`;
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
        document.getElementById('faixasTableContainer').hidden = true;
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

            const ref = Utils.getPressaoReferencia();
            if (!Number.isFinite(ref) || ref <= 0) {
                alert('⚠️ Informe a Pressão de Trabalho (100%) antes de carregar o CSV.');
                document.getElementById('pressaoTrabalho').focus();
                input.value = '';
                fileInfo.textContent = 'Nenhum arquivo selecionado';
                delete fileInfo.dataset.filename;
                return;
            }

            if (file.size > Processador.MAX_FILE_SIZE) {
                alert('Arquivo muito grande! Limite: 50 MB.');
                input.value = '';
                fileInfo.textContent = 'Nenhum arquivo selecionado';
                delete fileInfo.dataset.filename;
                return;
            }

            fileInfo.dataset.filename = file.name;
            fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(2)} KB)`;

            const reader = new FileReader();
            reader.onload = (ev) => Processador.processarTexto(String(ev.target.result || ''));
            reader.onerror = () => Processador._erro('Erro ao ler o arquivo.');
            reader.readAsText(file, 'UTF-8');
        });
    },

    _bindAcoes() {
        document.getElementById('btnLimparFormulario').addEventListener('click', (e) => {
            if (e.shiftKey) {
                if (!confirm('Isso vai apagar logo, responsáveis e pressão salvos. Continuar?')) return;
                Storage.salvarLogo(null);
                Storage.salvarResponsaveis([]);
                Storage.salvarPressao(null);
                State.logoDataURL = null;
                Logo.render();
                Responsaveis.grid.replaceChildren();
                Responsaveis.adicionar();
                Relatorio.els.pressao.value = '';
                Relatorio.atualizarPressaoDestaque();
            }
            Relatorio.limpar();
        });

        document.getElementById('btnLimparDados').addEventListener('click', () => this.limparDados());
        document.getElementById('btnImprimir').addEventListener('click', () => this.imprimir());
    },

    reanalisar() {
        if (!State.rawPressures.length || !State.rawTimes.length) return;

        const pressaoRef = Utils.getPressaoReferencia();
        if (!Number.isFinite(pressaoRef) || pressaoRef <= 0) {
            CanvasChart.destruir();
            document.getElementById('chartContainer').hidden = true;
            document.getElementById('chartLegend').hidden = true;
            document.getElementById('faixasTableContainer').hidden = true;
            document.getElementById('statsRow').hidden = true;
            State.dadosProcessados = false;
            return;
        }

        const times = State.rawTimes;
        const pressures = State.rawPressures;

        const faixasResultado = AnalisadorFaixas.analisar(times, pressures, pressaoRef);
        State.faixasResultado = faixasResultado;

        const t0 = Utils.parseTimeToSeconds(times[0]);
        const tN = Utils.parseTimeToSeconds(times[times.length - 1]);
        let duracaoTotalSeg = 0;
        if (Number.isFinite(t0) && Number.isFinite(tN)) {
            duracaoTotalSeg = tN - t0;
            if (duracaoTotalSeg < 0) duracaoTotalSeg += 24 * 3600;
        }

        Tabela.renderFaixas(faixasResultado, duracaoTotalSeg);
        Tabela.renderStats(pressures, faixasResultado);

        State.currentChartData = { times: [...times], lineData: [...pressures] };
        document.getElementById('chartContainer').hidden = false;
        CanvasChart.render(times, pressures, pressaoRef);
        Processador._updateLegend(times);

        State.dadosProcessados = true;
        Relatorio.atualizarCabecalho();
        document.getElementById('reportHeader').hidden = false;
    },

    limparDados() {
        CanvasChart.destruir();
        document.getElementById('chartContainer').hidden = true;
        document.getElementById('chartLegend').hidden = true;
        document.getElementById('faixasTableContainer').hidden = true;
        document.getElementById('statsRow').hidden = true;
        document.getElementById('reportHeader').hidden = true;

        const fileInfo = document.getElementById('fileInfo');
        fileInfo.textContent = 'Nenhum arquivo selecionado';
        delete fileInfo.dataset.filename;

        document.getElementById('errorMsg').hidden = true;
        document.getElementById('csvFile').value = '';

        State.dadosProcessados = false;
        State.rawTimes = [];
        State.rawPressures = [];
        State.currentChartData = null;
        State.faixasResultado = [];
        State.amostragemSegundos = 1;
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

        // Redesenha em alta resolução para impressão
        CanvasChart.renderParaImpressao(ref);

        // Aguarda render + abre diálogo
        setTimeout(() => {
            window.print();
            // Após imprimir, volta ao tamanho normal de tela
            setTimeout(() => CanvasChart.recriar(), 500);
        }, 300);
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
 * PWA — Service Worker
 * ---------------------------------------------------------------- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('./service-worker.js')
            .then((reg) => {
                if (State.debug) console.log('[PWA] Service Worker registrado:', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            if (confirm('Nova versão disponível. Recarregar agora?')) {
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