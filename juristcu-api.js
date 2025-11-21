const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { gerarResposta } = require('./llm-runner');
const { verificarQuotaOpenAI, verificarQuotaClaude } = require('./check-quota');
require('dotenv').config();

// ==================== CONFIGURAÇÕES ====================
const app = express();
const PORT = process.env.PORT || 3000;
const MODO_DEBUG = process.env.MODO_DEBUG === 'true';
const API_KEY = process.env.API_KEY;
const MAX_RETORNO_PADRAO = 10;

// Middleware
app.use(express.json());

// ==================== CONTROLE DE CHAVES DE IA ====================
let supabase;
let chaveGeminiAtual = 0;
let todasChavesGeminiFalharam = false;
let quotaClaudeExcedida = false;
let quotaOpenAIExcedida = false;
const chavesGemini = process.env.GEMINI_KEYS?.split(',').map(k => k.trim()).filter(k => k) || [];
const chaveClaude = process.env.ANTHROPIC_API_KEY;
const chaveOpenAI = process.env.OPENAI_API_KEY;

function log(mensagem) {
  if (MODO_DEBUG) {
    console.log(`[${new Date().toISOString()}] ${mensagem}`);
  }
}

function inicializarSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL e SUPABASE_KEY são obrigatórios no .env');
  }
  
  supabase = createClient(supabaseUrl, supabaseKey);
  log('Cliente Supabase inicializado');
  
  if (chavesGemini.length === 0 && !chaveClaude && !chaveOpenAI) {
    throw new Error('Pelo menos uma chave de IA é necessária (GEMINI_KEYS, ANTHROPIC_API_KEY ou OPENAI_API_KEY)');
  }
}

// ==================== MIDDLEWARE DE AUTENTICAÇÃO ====================
function autenticar(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    return res.status(401).json({
      erro: 'API Key não fornecida',
      mensagem: 'Inclua a chave no header X-API-Key ou Authorization: Bearer <key>'
    });
  }
  
  if (apiKey !== API_KEY) {
    log(`Tentativa de acesso com API Key inválida: ${apiKey.substring(0, 10)}...`);
    return res.status(403).json({
      erro: 'API Key inválida',
      mensagem: 'A chave fornecida não é válida'
    });
  }
  
  log('Autenticação bem-sucedida');
  next();
}

// ==================== CRITÉRIOS DE CATEGORIZAÇÃO ====================
const CRITERIOS = {
  'Licitações e Contratos': {
    'Irregularidades no processo licitatório': [
      'Envolve um procedimento de compra pública ou contratação regido pela Lei de Licitações',
      'Há indícios de violação aos princípios licitatórios (legalidade, isonomia, seleção da melhor proposta)',
      'O caso descreve alguma falha procedimental ou ilegalidade formal durante a licitação',
      'Resultou ou poderia resultar em prejuízo à competitividade ou à vantajosidade da contratação'
    ],
    'Dispensa ou inexigibilidade indevida': [
      'O caso refere-se a uma contratação direta (sem licitação)',
      'Não se comprovam os requisitos legais exigidos para justificar a contratação direta',
      'O objeto contratado e as circunstâncias indicam que seria cabível licitação',
      'Existe potencial dano ao erário ou favoritismo decorrente dessa contratação direta irregular'
    ],
    'Execução contratual e superfaturamento': [
      'O caso envolve um contrato administrativo já firmado e sua fase de execução',
      'Relata-se inadimplemento, defeito ou alteração irregular na execução do contrato',
      'Há indícios de sobrepreço ou superfaturamento',
      'A situação gerou ou pode gerar prejuízo financeiro à administração',
      'Falhas de supervisão contratual estão presentes'
    ]
  },
  'Gestão de Pessoal (Atos de Pessoal)': {
    'Admissão irregular de servidores (incluindo nepotismo)': [
      'Trata de preenchimento de cargo, emprego ou função pública',
      'Não foi observado o rito legal correto para provimento',
      'Há indicação de pessoal não qualificado ou com vínculo proibido (nepotismo)',
      'O princípio da impessoalidade/isonomia foi violado',
      'A decisão esperada do TCU seria pela ilegalidade do ato de admissão'
    ],
    'Concessão irregular de aposentadorias e pensões': [
      'O caso envolve a análise de um ato concessório de aposentadoria ou pensão',
      'Existe descumprimento de requisitos legais para o benefício',
      'Identifica-se pagamento indevido ou benefício mais vantajoso do que o devido',
      'Há indicação de potencial dano ao erário futuro',
      'O caso aponta para a necessidade de correção ou cancelamento do ato'
    ],
    'Acumulação indevida de cargos ou pagamentos irregulares': [
      'Descreve um agente público ocupando dois ou mais cargos simultaneamente',
      'A acumulação não se enquadra nas exceções constitucionais permitidas',
      'Pode envolver pagamentos indevidos acima do teto constitucional',
      'O caso sinaliza ofensa aos princípios da legalidade e moralidade administrativa',
      'A situação requer cessação de um dos vínculos ou devolução de valores'
    ]
  },
  'Prestação de Contas e Tomada de Contas Especial': {
    'Omissão ou não prestação de contas': [
      'Refere-se a recursos públicos com dever formal de prestar contas',
      'Constata-se que as contas não foram apresentadas no prazo legal',
      'A não prestação de contas é injustificada',
      'Existe potencial de dano ou irregularidade não esclarecida',
      'O desfecho típico é a instauração de Tomada de Contas Especial'
    ],
    'Prestação de contas irregular ou incompleta': [
      'O responsável apresentou as contas mas com falhas materiais',
      'Há despesas não comprovadas adequadamente ou fora do objeto previsto',
      'Auditoria identificou irregularidades quantitativas/qualitativas',
      'As falhas configuram violação a normas financeiras',
      'É necessário imputar responsabilidades ou ajustes'
    ]
  },
  'Convênios e Transferências Voluntárias': {
    'Execução não realizada ou deficiente do objeto conveniado': [
      'Trata-se de recursos federais transferidos via convênio ou instrumento similar',
      'O objeto pactuado não foi totalmente executado conforme previsto',
      'Não houve justificativa aceitável para a não execução integral',
      'Há indícios de responsabilidade do convenente pela falha',
      'O resultado é potencial prejuízo ao erário federal'
    ],
    'Desvio de finalidade ou uso indevido dos recursos transferidos': [
      'Refere-se a dinheiro público transferido com destinação vinculada',
      'Os recursos foram empregados em finalidade diversa da pactuada',
      'Tal desvio não foi autorizado formalmente pelo concedente',
      'A situação implicou benefício indevido ou prejuízo ao fim público',
      'Espera-se responsabilização com restituição dos valores desviados'
    ],
    'Prestação de contas do convênio irregular': [
      'A prestação de contas do convênio foi julgada irregular',
      'Pode haver omissão do convenente em prestar contas',
      'Não comprovação dos gastos conforme pactuado',
      'A consequência típica é a instauração de tomada de contas especial',
      'Responsabilização do gestor local omisso'
    ]
  },
  'Gestão Administrativa e Controle Interno': {
    'Falhas de controles internos e auditoria': [
      'Irregularidades que poderiam ter sido evitadas com controles eficazes',
      'Identifica-se ausência ou insuficiência de procedimentos de controle',
      'Há menção a procedimentos obrigatórios não realizados',
      'A falha de controle contribuiu diretamente para o prejuízo',
      'A correção requer reforço dos controles pela entidade'
    ],
    'Descumprimento de normas e deveres administrativos': [
      'Envolve não cumprimento de mandamento expresso em lei ou norma',
      'Exemplos típicos podem ser identificados (planos, relatórios, limites)',
      'A inação gerou ou pode gerar consequências negativas',
      'Há responsabilidade do gestor em cumprir aquele dever legal',
      'O caso se alinha a decisões em que o TCU emite determinações corretivas'
    ],
    'Uso inapropriado de recursos públicos (descontrole)': [
      'Uso indevido de verbas dentro da própria administração',
      'Despesas fora da competência do órgão ou alheia ao interesse público',
      'Falta de economicidade ou desperdícios',
      'Despesas irregulares por falha de gestão',
      'Deficiência de controle interno que permitiu o gasto errado'
    ]
  }
};

// ==================== FUNÇÃO DE RESUMO ====================
function imprimirResumoProcessamento(stats) {
  const tempoTotal = ((Date.now() - stats.inicioProcessamento) / 1000).toFixed(2);
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           RESUMO DO PROCESSAMENTO                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  console.log(`⏱️  Tempo total: ${tempoTotal}s`);
  console.log(`📊 Acórdãos analisados: ${stats.acordaosProcessados}/${stats.totalAcordaos}`);
  console.log(`✅ Acórdãos relevantes encontrados: ${stats.todosResultados.length}`);
  console.log(`📋 Acórdãos retornados: ${stats.resultadosFinais.length}`);
  console.log(`📈 Progresso: ${((stats.acordaosProcessados / stats.totalAcordaos) * 100).toFixed(1)}%`);
  
  console.log(`\n🤖 IAs utilizadas durante processamento:`);
  console.log(`   - Gemini: ${todasChavesGeminiFalharam ? '❌ Falharam todas as chaves' : '✅ Usado com sucesso'}`);
  console.log(`   - Claude: ${quotaClaudeExcedida ? '⚠️  Quota excedida' : (chaveClaude ? (todasChavesGeminiFalharam ? '✅ Usado com sucesso' : 'Não foi necessário') : 'Não configurado')}`);
  console.log(`   - OpenAI: ${quotaOpenAIExcedida ? '⚠️  Quota excedida' : (chaveOpenAI ? ((todasChavesGeminiFalharam && quotaClaudeExcedida) ? '✅ Usado com sucesso' : 'Não foi necessário') : 'Não configurado')}`);
  
  console.log('\n════════════════════════════════════════════════════════════\n');
}

// ==================== FUNÇÕES DE AVALIAÇÃO COM IA ====================
async function avaliarCriterioComIA(casoConcreto, acordao, criterio, llmAtual) {
  const prompt = `Você é um especialista em análise de acórdãos do TCU.

Analise se o seguinte caso concreto e o acórdão relacionado atendem ao critério especificado.

CASO CONCRETO:
${casoConcreto}

ACÓRDÃO (Número ${acordao.numero_acordao}/${acordao.ano_acordao}):
Título: ${acordao.titulo || 'N/A'}
Sumário: ${acordao.sumario || 'N/A'}
Texto extraído: ${acordao.texto_pdf ? acordao.texto_pdf.substring(0, 2000) : 'N/A'}

CRITÉRIO A AVALIAR:
${criterio}

Responda APENAS com um JSON no formato:
{
  "atende": true ou false,
  "justificativa": "explicação breve (max 200 caracteres)"
}

IMPORTANTE: Seja rigoroso. O critério deve ser claramente atendido.`;

  let apiKey;
  if (llmAtual === 'gemini') {
    apiKey = chavesGemini[chaveGeminiAtual];
  } else if (llmAtual === 'claude') {
    apiKey = chaveClaude;
  } else {
    apiKey = chaveOpenAI;
  }
  
  try {
    const resposta = await gerarResposta({
      prompt,
      llm: llmAtual,
      temperature: 0.1,
      apiKey
    });
    
    const jsonMatch = resposta.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { atende: false, justificativa: 'Resposta da IA inválida' };
    
  } catch (erro) {
    if (llmAtual === 'gemini') {
      log(`❌ Gemini falhou: ${erro.message.substring(0, 100)}`);
      throw new Error('ERRO_GEMINI');
    }
    
    if (llmAtual === 'claude') {
      log(`❌ Claude falhou: ${erro.message.substring(0, 100)}`);
      if (erro.status === 429 || erro.status === 402 || 
          erro.message.includes('rate_limit') || erro.message.includes('credit')) {
        quotaClaudeExcedida = true;
        throw new Error('QUOTA_CLAUDE_EXCEDIDA');
      }
      throw new Error('ERRO_CLAUDE');
    }
    
    if (llmAtual === 'openai') {
      log(`❌ OpenAI falhou: ${erro.message.substring(0, 100)}`);
      if (erro.message.includes('quota') || erro.message.includes('rate_limit') ||
          erro.message.includes('insufficient_quota') || erro.message.includes('429')) {
        quotaOpenAIExcedida = true;
        throw new Error('QUOTA_OPENAI_EXCEDIDA');
      }
      throw new Error('ERRO_OPENAI');
    }
    
    throw erro;
  }
}

// ==================== SELECIONAR LLM DISPONÍVEL ====================
function selecionarLLMDisponivel() {
  if (todasChavesGeminiFalharam && quotaClaudeExcedida && quotaOpenAIExcedida) {
    throw new Error('TODAS_IAS_INDISPONIVEIS');
  }
  
  if (!todasChavesGeminiFalharam && chavesGemini.length > 0) {
    return 'gemini';
  }
  
  if (todasChavesGeminiFalharam && chaveClaude && !quotaClaudeExcedida) {
    return 'claude';
  }
  
  if (todasChavesGeminiFalharam && quotaClaudeExcedida && chaveOpenAI && !quotaOpenAIExcedida) {
    return 'openai';
  }
  
  throw new Error('TODAS_IAS_INDISPONIVEIS');
}

async function avaliarCategoriaSubcategoria(casoConcreto, acordao, categoria, subcategoria) {
  const criterios = CRITERIOS[categoria][subcategoria];
  const resultados = {
    categoria,
    subcategoria,
    criterios: [],
    totalCriterios: criterios.length,
    criteriosAtendidos: 0,
    percentualAtendimento: 0
  };
  
  log(`  Avaliando: ${categoria} > ${subcategoria}`);
  
  for (let i = 0; i < criterios.length; i++) {
    const criterio = criterios[i];
    
    let llmAtual;
    try {
      llmAtual = selecionarLLMDisponivel();
    } catch (erro) {
      if (erro.message === 'TODAS_IAS_INDISPONIVEIS') {
        throw erro;
      }
    }
    
    log(`    Critério ${i + 1}/${criterios.length} [${llmAtual.toUpperCase()}]`);
    
    try {
      const avaliacao = await avaliarCriterioComIA(casoConcreto, acordao, criterio, llmAtual);
      
      resultados.criterios.push({
        numero: i + 1,
        texto: criterio,
        atende: avaliacao.atende,
        justificativa: avaliacao.justificativa
      });
      
      if (avaliacao.atende) {
        resultados.criteriosAtendidos++;
        log(`      ✅ ATENDE`);
      } else {
        log(`      ❌ NÃO ATENDE`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (erro) {
      if (erro.message === 'ERRO_GEMINI' && llmAtual === 'gemini') {
        chaveGeminiAtual++;
        
        if (chaveGeminiAtual < chavesGemini.length) {
          log(`    ⚠️  Gemini chave ${chaveGeminiAtual}/${chavesGemini.length} falhou - tentando próxima chave`);
          i--;
          continue;
        } else {
          todasChavesGeminiFalharam = true;
          log('\n╔════════════════════════════════════════════════════════════╗');
          log('║  🚫 TODAS AS CHAVES GEMINI FALHARAM                        ║');
          log('║  ➡️  MUDANDO PERMANENTEMENTE PARA CLAUDE                   ║');
          log('╚════════════════════════════════════════════════════════════╝\n');
          i--;
          continue;
        }
      }
      
      if ((erro.message === 'QUOTA_CLAUDE_EXCEDIDA' || erro.message === 'ERRO_CLAUDE') && llmAtual === 'claude') {
        quotaClaudeExcedida = true;
        log('\n╔════════════════════════════════════════════════════════════╗');
        log('║  ⚠️  CLAUDE FALHOU OU QUOTA EXCEDIDA                       ║');
        log('║  ➡️  MUDANDO PERMANENTEMENTE PARA OPENAI                   ║');
        log('╚════════════════════════════════════════════════════════════╝\n');
        i--;
        continue;
      }
      
      if (erro.message === 'QUOTA_OPENAI_EXCEDIDA') {
        log('    🚫 Quota OpenAI excedida - última IA disponível falhou');
        throw erro;
      }
      
      if (erro.message === 'ERRO_OPENAI') {
        log('    🚫 OpenAI falhou - última IA disponível com erro');
        quotaOpenAIExcedida = true;
        throw new Error('QUOTA_OPENAI_EXCEDIDA');
      }
      
      if (erro.message === 'TODAS_IAS_INDISPONIVEIS') {
        throw erro;
      }
      
      log(`    ⚠️  Erro não tratado: ${erro.message}`);
      resultados.criterios.push({
        numero: i + 1,
        texto: criterio,
        atende: false,
        justificativa: `Erro não tratado`
      });
    }
  }
  
  resultados.percentualAtendimento = (resultados.criteriosAtendidos / resultados.totalCriterios) * 100;
  
  return resultados;
}

// ==================== BUSCAR TODOS OS ACÓRDÃOS ====================
async function buscarTodosAcordaos() {
  try {
    log('Buscando TODOS os acórdãos do banco de dados...');
    
    const { data, error } = await supabase
      .from('acordaos')
      .select('*')
      .not('texto_pdf', 'is', null)
      .not('sumario', 'is', null)
      .order('data_sessao', { ascending: false });
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      return [];
    }
    
    log(`✅ ${data.length} acórdãos encontrados no banco de dados`);
    
    return data;
  } catch (erro) {
    log(`❌ Erro ao buscar acórdãos: ${erro.message}`);
    throw erro;
  }
}

// ==================== ENDPOINT PRINCIPAL ====================
app.post('/api/v1/analisar-caso', autenticar, async (req, res) => {
  const inicioProcessamento = Date.now();
  const dataHoraInicio = new Date().toISOString();
  log('\n========== NOVA REQUISIÇÃO DE ANÁLISE ==========');
  
  const stats = {
    inicioProcessamento,
    acordaosProcessados: 0,
    totalAcordaos: 0,
    todosResultados: [],
    resultadosFinais: []
  };
  
  try {
    const { caso_concreto, max_resultados, max_acordaos } = req.body;
    
    if (!caso_concreto || typeof caso_concreto !== 'string') {
      return res.status(400).json({
        erro: 'Parâmetro inválido',
        mensagem: 'O campo "caso_concreto" é obrigatório e deve ser uma string'
      });
    }
    
    if (caso_concreto.length < 50) {
      return res.status(400).json({
        erro: 'Caso muito curto',
        mensagem: 'O caso concreto deve ter pelo menos 50 caracteres'
      });
    }
    
    const limiteRetorno = Math.min(max_resultados || MAX_RETORNO_PADRAO, 100);
    const limiteProcessamento = max_acordaos ? Math.min(max_acordaos, 10000) : null;
    
    log(`Caso concreto: ${caso_concreto.substring(0, 100)}...`);
    log(`Limite de processamento: ${limiteProcessamento ? `${limiteProcessamento} acórdãos` : 'TODOS os acórdãos'}`);
    log(`Limite de retorno: ${limiteRetorno} acórdãos mais relevantes`);
    
    if (chaveOpenAI) {
      try {
        const quotaOpenAI = await verificarQuotaOpenAI({ apiKey: chaveOpenAI });
        log(`Quota OpenAI: ${quotaOpenAI.disponivel ? 'OK' : 'INDISPONÍVEL'}`);
      } catch (erro) {
        log(`Aviso: Não foi possível verificar quota OpenAI: ${erro.message}`);
      }
    }
    
    if (chaveClaude) {
      try {
        const quotaClaude = await verificarQuotaClaude({ apiKey: chaveClaude });
        log(`Quota Claude: ${quotaClaude.disponivel ? 'OK' : 'INDISPONÍVEL'}`);
      } catch (erro) {
        log(`Aviso: Não foi possível verificar quota Claude: ${erro.message}`);
      }
    }
    
    const todosAcordaos = await buscarTodosAcordaos();
    
    if (todosAcordaos.length === 0) {
      return res.status(404).json({
        erro: 'Nenhum acórdão encontrado',
        mensagem: 'Não há acórdãos com texto processado no banco de dados'
      });
    }
    
    stats.totalAcordaos = todosAcordaos.length;
    
    log(`\n🔍 Iniciando análise de TODOS os ${todosAcordaos.length} acórdãos do banco...`);
    log(`📊 Serão retornados os ${limiteRetorno} acórdãos mais relevantes\n`);
    
    const todosResultados = [];
    let acordaosProcessados = 0;
    
    for (let i = 0; i < todosAcordaos.length; i++) {
      const acordao = todosAcordaos[i];
      
      log(`\n[${i + 1}/${todosAcordaos.length}] Analisando Acórdão ${acordao.numero_acordao}/${acordao.ano_acordao}`);
      
      try {
        const categoriasEncontradas = [];
        
        for (const [categoria, subcategorias] of Object.entries(CRITERIOS)) {
          for (const subcategoria of Object.keys(subcategorias)) {
            
            try {
              const resultado = await avaliarCategoriaSubcategoria(
                caso_concreto,
                acordao,
                categoria,
                subcategoria
              );
              
              if (resultado.percentualAtendimento >= 60) {
                categoriasEncontradas.push(resultado);
              }
            } catch (erro) {
              if (erro.message === 'QUOTA_OPENAI_EXCEDIDA') {
                log('\n🚫 QUOTA DA OPENAI EXCEDIDA - Parando processamento');
                
                stats.acordaosProcessados = acordaosProcessados;
                stats.todosResultados = todosResultados;
                stats.resultadosFinais = todosResultados
                  .sort((a, b) => b.melhor_percentual - a.melhor_percentual)
                  .slice(0, limiteRetorno);
                
                imprimirResumoProcessamento(stats);
                
                return res.status(503).json({
                  erro: 'Quota de IA excedida',
                  mensagem: 'A quota da OpenAI foi excedida durante o processamento.',
                  resultados_parciais: stats.resultadosFinais.map(r => ({
                    acordao: r.acordao,
                    categorias: r.categorias
                  })),
                  acordaos_processados: acordaosProcessados,
                  total_acordaos: todosAcordaos.length,
                  progresso_percentual: ((acordaosProcessados / todosAcordaos.length) * 100).toFixed(2)
                });
              }
              
              if (erro.message === 'QUOTA_CLAUDE_EXCEDIDA') {
                log('\n⚠️  QUOTA DO CLAUDE EXCEDIDA - continuando com próxima IA');
                quotaClaudeExcedida = true;
                continue;
              }
              
              if (erro.message === 'TODAS_IAS_INDISPONIVEIS') {
                log('\n⚠️  TODAS AS IAs INDISPONÍVEIS - Parando processamento');
                
                stats.acordaosProcessados = acordaosProcessados;
                stats.todosResultados = todosResultados;
                stats.resultadosFinais = todosResultados
                  .sort((a, b) => b.melhor_percentual - a.melhor_percentual)
                  .slice(0, limiteRetorno);
                
                imprimirResumoProcessamento(stats);
                
                return res.status(503).json({
                  erro: 'Serviços de IA indisponíveis',
                  mensagem: 'Todas as opções de IA estão indisponíveis no momento.',
                  detalhes: {
                    gemini: todasChavesGeminiFalharam ? 'Todas as chaves falharam' : 'Disponível',
                    claude: quotaClaudeExcedida ? 'Quota excedida' : (chaveClaude ? 'Disponível' : 'Não configurado'),
                    openai: quotaOpenAIExcedida ? 'Quota excedida' : (chaveOpenAI ? 'Disponível' : 'Não configurado')
                  },
                  resultados_parciais: stats.resultadosFinais.map(r => ({
                    acordao: r.acordao,
                    categorias: r.categorias
                  })),
                  acordaos_processados: acordaosProcessados,
                  total_acordaos: todosAcordaos.length,
                  progresso_percentual: ((acordaosProcessados / todosAcordaos.length) * 100).toFixed(2)
                });
              }
              
              throw erro;
            }
          }
        }
        
        acordaosProcessados++;
        
        if (categoriasEncontradas.length > 0) {
          const melhorPercentual = Math.max(...categoriasEncontradas.map(c => c.percentualAtendimento));
          
          todosResultados.push({
            acordao: {
              id: acordao.id,
              numero: acordao.numero_acordao,
              ano: acordao.ano_acordao,
              titulo: acordao.titulo,
              data_sessao: acordao.data_sessao,
              relator: acordao.relator,
              colegiado: acordao.colegiado,
              url_acordao: acordao.url_acordao
            },
            categorias: categoriasEncontradas.sort((a, b) => 
              b.percentualAtendimento - a.percentualAtendimento
            ),
            melhor_percentual: melhorPercentual
          });
          
          log(`  ✅ Acórdão relevante encontrado! Melhor match: ${melhorPercentual.toFixed(1)}%`);
        }
        
        if (acordaosProcessados % 10 === 0) {
          const progresso = ((acordaosProcessados / todosAcordaos.length) * 100).toFixed(1);
          log(`\n📈 Progresso: ${acordaosProcessados}/${todosAcordaos.length} (${progresso}%) - ${todosResultados.length} relevantes encontrados`);
        }
        
      } catch (erro) {
        log(`⚠️  Erro ao processar acórdão ${acordao.numero_acordao}/${acordao.ano_acordao}: ${erro.message}`);
        acordaosProcessados++;
      }
    }
    
    const resultadosFinais = todosResultados
      .sort((a, b) => b.melhor_percentual - a.melhor_percentual)
      .slice(0, limiteRetorno)
      .map(r => ({
        acordao: r.acordao,
        categorias: r.categorias
      }));
    
    stats.acordaosProcessados = acordaosProcessados;
    stats.todosResultados = todosResultados;
    stats.resultadosFinais = resultadosFinais;
    
    imprimirResumoProcessamento(stats);
    
    const tempoTotal = ((Date.now() - inicioProcessamento) / 1000).toFixed(2);
    
    res.status(200).json({
      sucesso: true,
      caso_concreto: caso_concreto.substring(0, 200) + '...',
      total_acordaos_banco: todosAcordaos.length,
      acordaos_processados: acordaosProcessados,
      acordaos_relevantes_encontrados: todosResultados.length,
      acordaos_retornados: resultadosFinais.length,
      tempo_processamento_segundos: parseFloat(tempoTotal),
      resultados: resultadosFinais,
      estatisticas: {
        gemini_usado: !todasChavesGeminiFalharam,
        claude_usado: chaveClaude && !quotaClaudeExcedida && todasChavesGeminiFalharam,
        openai_usado: (todasChavesGeminiFalharam || !chavesGemini.length) && 
                      (quotaClaudeExcedida || !chaveClaude) && !quotaOpenAIExcedida,
        quota_claude_excedida: quotaClaudeExcedida,
        quota_openai_excedida: quotaOpenAIExcedida,
        progresso_percentual: ((acordaosProcessados / todosAcordaos.length) * 100).toFixed(2)
      }
    });
    
  } catch (erro) {
    console.error('Erro no processamento:', erro);
    
    res.status(500).json({
      erro: 'Erro interno do servidor',
      mensagem: erro.message,
      detalhes: MODO_DEBUG ? erro.stack : undefined
    });
  }
});

// ==================== ENDPOINT DE SAÚDE ====================
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    versao: '1.0.0',
    servicos: {
      supabase: supabase ? 'conectado' : 'desconectado',
      gemini: chavesGemini.length > 0 ? `${chavesGemini.length} chave(s)` : 'não configurado',
      claude: chaveClaude ? 'configurado' : 'não configurado',
      openai: chaveOpenAI ? 'configurado' : 'não configurado'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== ENDPOINT DE INFORMAÇÕES ====================
app.get('/api/v1/info', autenticar, (req, res) => {
  res.status(200).json({
    nome: 'JurisTCU API',
    versao: '1.0.0',
    descricao: 'API para análise e categorização de casos concretos baseado em acórdãos do TCU',
    endpoints: {
      '/api/v1/health': 'Verificar status da API (público)',
      '/api/v1/info': 'Informações sobre a API (requer autenticação)',
      '/api/v1/analisar-caso': 'Analisar caso concreto (POST, requer autenticação)'
    },
    categorias_disponiveis: Object.keys(CRITERIOS),
    autenticacao: 'Necessário header X-API-Key ou Authorization: Bearer <key>',
    comportamento: {
      processamento: 'Analisa TODOS os acórdãos do banco de dados',
      retorno: 'Retorna apenas os X acórdãos mais relevantes (definido por max_resultados)',
      limite_retorno_padrao: MAX_RETORNO_PADRAO,
      limite_retorno_maximo: 100
    }
  });
});

// ==================== ENDPOINT DE ESTATÍSTICAS DO BANCO ====================
app.get('/api/v1/estatisticas', autenticar, async (req, res) => {
  try {
    const { count: totalAcordaos, error: errorCount } = await supabase
      .from('acordaos')
      .select('*', { count: 'exact', head: true });
    
    if (errorCount) throw errorCount;
    
    const { count: acordaosComTexto, error: errorTexto } = await supabase
      .from('acordaos')
      .select('*', { count: 'exact', head: true })
      .not('texto_pdf', 'is', null)
      .not('sumario', 'is', null);
    
    if (errorTexto) throw errorTexto;
    
    res.status(200).json({
      sucesso: true,
      total_acordaos: totalAcordaos,
      acordaos_processaveis: acordaosComTexto,
      acordaos_sem_texto: totalAcordaos - acordaosComTexto,
      percentual_processavel: ((acordaosComTexto / totalAcordaos) * 100).toFixed(2) + '%'
    });
    
  } catch (erro) {
    res.status(500).json({
      erro: 'Erro ao buscar estatísticas',
      mensagem: erro.message
    });
  }
});

// ==================== TRATAMENTO DE ERROS 404 ====================
app.use((req, res) => {
  res.status(404).json({
    erro: 'Endpoint não encontrado',
    mensagem: `O endpoint ${req.method} ${req.path} não existe`,
    endpoints_disponiveis: [
      'GET /api/v1/health',
      'GET /api/v1/info',
      'GET /api/v1/estatisticas',
      'POST /api/v1/analisar-caso'
    ]
  });
});

// ==================== INICIALIZAÇÃO ====================
async function iniciar() {
  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     JURISTCU API - Sistema de Análise de Acórdãos          ║');
    console.log('║     v1.0.0                                                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    if (!API_KEY) {
      throw new Error('API_KEY não configurada no .env');
    }
    
    if (!API_KEY.startsWith('tcu_')) {
      throw new Error('API_KEY deve começar com "tcu_"');
    }
    
    if (chavesGemini.length === 0 && !chaveClaude && !chaveOpenAI) {
      throw new Error('Pelo menos uma chave de IA é necessária (GEMINI_KEYS, ANTHROPIC_API_KEY ou OPENAI_API_KEY)');
    }
    
    inicializarSupabase();
    
    try {
      const { count: totalAcordaos } = await supabase
        .from('acordaos')
        .select('*', { count: 'exact', head: true });
      
      const { count: acordaosComTexto } = await supabase
        .from('acordaos')
        .select('*', { count: 'exact', head: true })
        .not('texto_pdf', 'is', null)
        .not('sumario', 'is', null);
      
      console.log('✅ Configurações carregadas:');
      console.log(`   - Modo Debug: ${MODO_DEBUG ? 'ATIVADO' : 'DESATIVADO'}`);
      console.log(`   - API Key: ${API_KEY.substring(0, 10)}...`);
      console.log(`   - Chaves Gemini: ${chavesGemini.length}`);
      console.log(`   - Claude: ${chaveClaude ? 'Configurado' : 'Não configurado'}`);
      console.log(`   - OpenAI: ${chaveOpenAI ? 'Configurado' : 'Não configurado'}`);
      console.log(`   - Porta: ${PORT}`);
      console.log(`\n📊 Estatísticas do Banco:`);
      console.log(`   - Total de Acórdãos: ${totalAcordaos}`);
      console.log(`   - Acórdãos Processáveis: ${acordaosComTexto}`);
      console.log(`   - Percentual Processável: ${((acordaosComTexto / totalAcordaos) * 100).toFixed(2)}%`);
      console.log(`\n⚙️  Comportamento:`);
      console.log(`   - Processa: TODOS os ${acordaosComTexto} acórdãos`);
      console.log(`   - Retorna: Top ${MAX_RETORNO_PADRAO} mais relevantes (configurável)`);
      console.log(`   - Limite máximo de retorno: 100 acórdãos\n`);
      
    } catch (erro) {
      console.log('⚠️  Não foi possível buscar estatísticas do banco');
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
      console.log(`📡 Endpoints disponíveis:`);
      console.log(`   - GET  /api/v1/health (público)`);
      console.log(`   - GET  /api/v1/info (autenticado)`);
      console.log(`   - GET  /api/v1/estatisticas (autenticado)`);
      console.log(`   - POST /api/v1/analisar-caso (autenticado)`);
      console.log(`\n💡 Para testar: curl http://localhost:${PORT}/api/v1/health\n`);
    });
    
  } catch (erro) {
    console.error('\n❌ ERRO NA INICIALIZAÇÃO:', erro.message);
    process.exit(1);
  }
}

iniciar();