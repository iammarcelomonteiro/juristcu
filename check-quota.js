// check-quota.js
// Verificação de quota e rate limits do OpenAI e Claude (Anthropic)
require('dotenv').config();
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

// ==================== VERIFICAÇÃO OPENAI ====================
async function verificarQuotaOpenAI({
  apiKey = process.env.OPENAI_API_KEY,
  days = 1
} = {}) {
  if (!apiKey) {
    throw new Error("Informe OPENAI_API_KEY ou passe apiKey no parâmetro.");
  }

  const openai = new OpenAI({ apiKey });

  try {
    const rateLimits = {};
    let disponivel = true;
    let quotaExcedida = false;
    let errorDetails = null;

    try {
      // Fazer uma chamada mínima para validar a chave e obter informações
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Usar modelo mais barato para teste
        max_tokens: 5,
        messages: [
          { role: 'user', content: 'teste' }
        ]
      });

      // OpenAI retorna informações de uso no objeto de resposta
      if (completion) {
        rateLimits.status = 'ok';
        rateLimits.model_used = completion.model;
        rateLimits.tokens_used = completion.usage?.total_tokens || 0;
        rateLimits.prompt_tokens = completion.usage?.prompt_tokens || 0;
        rateLimits.completion_tokens = completion.usage?.completion_tokens || 0;
      }

      // Tentar buscar informações de billing (se disponível)
      // Nota: A API de billing da OpenAI requer permissões especiais
      try {
        const subscription = await openai.billing?.subscription?.retrieve?.();
        if (subscription) {
          rateLimits.plan = subscription.plan?.title || 'N/A';
        }
      } catch (billingError) {
        // Ignorar erros de billing - não é crítico
        rateLimits.billing_note = 'Informações de billing não disponíveis (requer permissões especiais)';
      }

    } catch (erro) {
      // Capturar erros específicos de quota/rate limit
      disponivel = false;
      errorDetails = erro.message;

      if (erro.status === 429 || erro.message?.includes('429')) {
        quotaExcedida = true;
        errorDetails = 'Rate limit excedido - muitas requisições ou quota esgotada';
      } else if (erro.status === 401) {
        errorDetails = 'API Key inválida ou expirada';
      } else if (erro.status === 403) {
        errorDetails = 'Acesso negado - verifique permissões da API Key';
      } else if (erro.message?.includes('quota')) {
        quotaExcedida = true;
        errorDetails = 'Quota excedida - adicione créditos ou aguarde o reset';
      } else if (erro.message?.includes('insufficient_quota')) {
        quotaExcedida = true;
        errorDetails = 'Quota insuficiente - adicione créditos em platform.openai.com/settings/billing';
      } else if (erro.message?.includes('rate_limit')) {
        quotaExcedida = true;
        errorDetails = 'Rate limit atingido';
      }
    }

    // Informações sobre uso
    const usage = {
      periodo: `${days} dia(s)`,
      aviso: 'Para uso detalhado, acesse platform.openai.com/usage',
      console_url: 'https://platform.openai.com/usage'
    };

    const costs = {
      periodo: `${days} dia(s)`,
      aviso: 'Para ver custos detalhados, acesse platform.openai.com/usage',
      console_url: 'https://platform.openai.com/usage',
      precos_referencia: {
        'gpt-4o': {
          input: '$2.50 por 1M tokens',
          output: '$10.00 por 1M tokens'
        },
        'gpt-4o-mini': {
          input: '$0.15 por 1M tokens',
          output: '$0.60 por 1M tokens'
        },
        'gpt-4-turbo': {
          input: '$10.00 por 1M tokens',
          output: '$30.00 por 1M tokens'
        }
      }
    };

    return {
      rate_limits: rateLimits,
      usage,
      costs,
      disponivel,
      quota_excedida: quotaExcedida,
      erro: errorDetails,
      detalhes: {
        api_key_valida: disponivel,
        creditos_disponiveis: disponivel && !quotaExcedida,
        verificar_em: 'https://platform.openai.com/usage'
      }
    };

  } catch (erro) {
    console.error('Erro ao verificar quota OpenAI:', erro.message);
    
    // Verificar se é erro de quota excedida
    if (erro.status === 429 || 
        erro.message?.includes('429') || 
        erro.message?.includes('quota') || 
        erro.message?.includes('insufficient_quota') ||
        erro.message?.includes('rate_limit')) {
      return {
        rate_limits: {},
        usage: null,
        costs: null,
        disponivel: false,
        quota_excedida: true,
        erro: erro.message,
        detalhes: {
          status_code: erro.status,
          mensagem: 'Quota ou rate limit excedido',
          solucao: 'Adicione créditos em https://platform.openai.com/settings/billing ou aguarde o reset do rate limit'
        }
      };
    }
    
    throw erro;
  }
}

// ==================== VERIFICAÇÃO CLAUDE ====================
async function verificarQuotaClaude({
  apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
  days = 1
} = {}) {
  if (!apiKey) {
    throw new Error("Informe CLAUDE_API_KEY/ANTHROPIC_API_KEY ou passe apiKey no parâmetro.");
  }

  const anthropic = new Anthropic({ apiKey });

  try {
    // IMPORTANTE: A Anthropic não expõe endpoints públicos de usage/billing como a OpenAI
    // A verificação é feita através de uma chamada de teste mínima para validar a chave
    // e capturar os headers de rate limit
    
    const rateLimits = {};
    let disponivel = true;
    let quotaExcedida = false;
    let errorDetails = null;

    try {
      // Fazer uma chamada mínima para obter rate limits nos headers
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'teste' }
        ]
      });

      // A API Anthropic retorna informações de rate limit no objeto de resposta
      if (message) {
        rateLimits.status = 'ok';
        rateLimits.model_used = message.model;
        rateLimits.tokens_used = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);
        rateLimits.input_tokens = message.usage?.input_tokens || 0;
        rateLimits.output_tokens = message.usage?.output_tokens || 0;
      }

    } catch (erro) {
      // Capturar erros específicos de quota/rate limit
      disponivel = false;
      errorDetails = erro.message;

      if (erro.status === 429) {
        quotaExcedida = true;
        errorDetails = 'Rate limit excedido - muitas requisições';
      } else if (erro.status === 402) {
        quotaExcedida = true;
        errorDetails = 'Créditos insuficientes - adicione créditos em console.anthropic.com';
      } else if (erro.status === 401) {
        errorDetails = 'API Key inválida ou expirada';
      } else if (erro.status === 403) {
        errorDetails = 'Acesso negado - verifique permissões da API Key';
      } else if (erro.message?.includes('credit')) {
        quotaExcedida = true;
        errorDetails = 'Sem créditos disponíveis';
      } else if (erro.message?.includes('rate_limit')) {
        quotaExcedida = true;
        errorDetails = 'Rate limit atingido';
      }
    }

    // Informações sobre uso (simuladas - Anthropic não expõe API pública de billing)
    const usage = {
      periodo: `${days} dia(s)`,
      aviso: 'A Anthropic não expõe API pública de usage. Acesse console.anthropic.com/settings/billing para detalhes.',
      console_url: 'https://console.anthropic.com/settings/billing'
    };

    const costs = {
      periodo: `${days} dia(s)`,
      aviso: 'Para ver custos detalhados, acesse console.anthropic.com/settings/billing',
      console_url: 'https://console.anthropic.com/settings/billing',
      precos_referencia: {
        'claude-sonnet-4-5': {
          input: '$3.00 por 1M tokens',
          output: '$15.00 por 1M tokens'
        },
        'claude-sonnet-4': {
          input: '$3.00 por 1M tokens',
          output: '$15.00 por 1M tokens'
        },
        'claude-opus-4-1': {
          input: '$15.00 por 1M tokens',
          output: '$75.00 por 1M tokens'
        },
        'claude-opus-4': {
          input: '$15.00 por 1M tokens',
          output: '$75.00 por 1M tokens'
        }
      }
    };

    return {
      rate_limits: rateLimits,
      usage,
      costs,
      disponivel,
      quota_excedida: quotaExcedida,
      erro: errorDetails,
      detalhes: {
        api_key_valida: disponivel,
        creditos_disponiveis: disponivel && !quotaExcedida,
        verificar_em: 'https://console.anthropic.com/settings/billing'
      }
    };

  } catch (erro) {
    console.error('Erro ao verificar quota Claude:', erro.message);
    
    // Verificar se é erro de quota excedida
    if (erro.status === 429 || 
        erro.status === 402 ||
        erro.message?.includes('429') || 
        erro.message?.includes('quota') || 
        erro.message?.includes('credit') ||
        erro.message?.includes('rate_limit')) {
      return {
        rate_limits: {},
        usage: null,
        costs: null,
        disponivel: false,
        quota_excedida: true,
        erro: erro.message,
        detalhes: {
          status_code: erro.status,
          mensagem: 'Quota ou rate limit excedido',
          solucao: 'Adicione créditos em https://console.anthropic.com/settings/billing ou aguarde o reset do rate limit'
        }
      };
    }
    
    throw erro;
  }
}

// ==================== VERIFICAR TODAS AS IAs ====================
async function verificarTodasIAs() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   VERIFICAÇÃO DE QUOTA - TODAS AS IAs                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const resultados = {
    openai: null,
    claude: null,
    gemini: null
  };
  
  // Verificar OpenAI
  if (process.env.OPENAI_API_KEY) {
    console.log('🔍 Verificando OpenAI...');
    try {
      resultados.openai = await verificarQuotaOpenAI();
      if (resultados.openai.disponivel && !resultados.openai.quota_excedida) {
        console.log('   ✅ OpenAI: DISPONÍVEL\n');
      } else if (resultados.openai.quota_excedida) {
        console.log('   ❌ OpenAI: QUOTA EXCEDIDA');
        console.log(`   Erro: ${resultados.openai.erro}\n`);
      } else {
        console.log('   ⚠️  OpenAI: ERRO');
        console.log(`   Erro: ${resultados.openai.erro}\n`);
      }
    } catch (erro) {
      console.log('   ❌ OpenAI: ERRO');
      console.log(`   Erro: ${erro.message}\n`);
      resultados.openai = { disponivel: false, erro: erro.message };
    }
  } else {
    console.log('   ⚪ OpenAI: Não configurado (OPENAI_API_KEY ausente)\n');
  }
  
  // Verificar Claude
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
    console.log('🔍 Verificando Claude...');
    try {
      resultados.claude = await verificarQuotaClaude();
      if (resultados.claude.disponivel && !resultados.claude.quota_excedida) {
        console.log('   ✅ Claude: DISPONÍVEL\n');
      } else if (resultados.claude.quota_excedida) {
        console.log('   ❌ Claude: QUOTA EXCEDIDA');
        console.log(`   Erro: ${resultados.claude.erro}\n`);
      } else {
        console.log('   ⚠️  Claude: ERRO');
        console.log(`   Erro: ${resultados.claude.erro}\n`);
      }
    } catch (erro) {
      console.log('   ❌ Claude: ERRO');
      console.log(`   Erro: ${erro.message}\n`);
      resultados.claude = { disponivel: false, erro: erro.message };
    }
  } else {
    console.log('   ⚪ Claude: Não configurado (ANTHROPIC_API_KEY ausente)\n');
  }
  
  // Verificar Gemini (apenas informativo - não faz chamada real)
  const chavesGemini = process.env.GEMINI_KEYS?.split(',').filter(k => k.trim()) || [];
  if (chavesGemini.length > 0) {
    console.log('🔍 Gemini:');
    console.log(`   ℹ️  ${chavesGemini.length} chave(s) configurada(s)`);
    console.log('   ⚠️  Verificação automática não implementada (requer biblioteca específica)\n');
    resultados.gemini = { 
      chaves_configuradas: chavesGemini.length,
      nota: 'Verificação manual necessária'
    };
  } else {
    console.log('   ⚪ Gemini: Não configurado (GEMINI_KEYS ausente)\n');
  }
  
  // Resumo
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   RESUMO                                                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const openaiOk = resultados.openai?.disponivel && !resultados.openai?.quota_excedida;
  const claudeOk = resultados.claude?.disponivel && !resultados.claude?.quota_excedida;
  const geminiOk = chavesGemini.length > 0;
  
  console.log(`OpenAI: ${openaiOk ? '✅ Disponível' : (resultados.openai ? '❌ Indisponível' : '⚪ Não configurado')}`);
  console.log(`Claude: ${claudeOk ? '✅ Disponível' : (resultados.claude ? '❌ Indisponível' : '⚪ Não configurado')}`);
  console.log(`Gemini: ${geminiOk ? `ℹ️  ${chavesGemini.length} chave(s)` : '⚪ Não configurado'}`);
  
  const algumDisponivel = openaiOk || claudeOk || geminiOk;
  
  if (algumDisponivel) {
    console.log('\n✅ Pelo menos uma IA está disponível para uso');
  } else {
    console.log('\n❌ ATENÇÃO: Nenhuma IA está disponível!');
  }
  
  console.log('');
  
  return resultados;
}

// ==================== USO VIA CLI ====================
if (require.main === module) {
  const args = process.argv.slice(2);
  const comando = args[0];
  
  if (comando === 'openai') {
    // Verificar apenas OpenAI
    verificarQuotaOpenAI({ days: 7 })
      .then((res) => {
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║   VERIFICAÇÃO DE QUOTA OPENAI                              ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        
        console.log('📊 Rate Limits:');
        console.log(JSON.stringify(res.rate_limits, null, 2));
        
        console.log('\n📈 Usage (últimos 7 dias):');
        console.log(JSON.stringify(res.usage, null, 2));
        
        console.log('\n💰 Costs:');
        console.log(JSON.stringify(res.costs, null, 2));
        
        console.log('\n🔍 Detalhes:');
        console.log(JSON.stringify(res.detalhes, null, 2));
        
        if (res.disponivel && !res.quota_excedida) {
          console.log('\n✅ Status: DISPONÍVEL');
        } else if (res.quota_excedida) {
          console.log('\n❌ Status: QUOTA EXCEDIDA');
          console.log('Erro:', res.erro);
        } else {
          console.log('\n⚠️  Status: ERRO');
          console.log('Erro:', res.erro);
        }
        
        console.log('\n💡 Para verificar saldo e uso detalhado, acesse:');
        console.log('   https://platform.openai.com/usage');
        console.log('');
      })
      .catch((err) => {
        console.error("\n❌ Erro:", err.message || err);
        console.log("\n💡 Dica: Verifique se a API Key está correta no .env");
        console.log("   OPENAI_API_KEY\n");
        process.exit(1);
      });
      
  } else if (comando === 'claude') {
    // Verificar apenas Claude
    verificarQuotaClaude({ days: 7 })
      .then((res) => {
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║   VERIFICAÇÃO DE QUOTA CLAUDE (ANTHROPIC)                  ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');
        
        console.log('📊 Rate Limits:');
        console.log(JSON.stringify(res.rate_limits, null, 2));
        
        console.log('\n📈 Usage (últimos 7 dias):');
        console.log(JSON.stringify(res.usage, null, 2));
        
        console.log('\n💰 Costs:');
        console.log(JSON.stringify(res.costs, null, 2));
        
        console.log('\n🔍 Detalhes:');
        console.log(JSON.stringify(res.detalhes, null, 2));
        
        if (res.disponivel && !res.quota_excedida) {
          console.log('\n✅ Status: DISPONÍVEL');
        } else if (res.quota_excedida) {
          console.log('\n❌ Status: QUOTA EXCEDIDA');
          console.log('Erro:', res.erro);
        } else {
          console.log('\n⚠️  Status: ERRO');
          console.log('Erro:', res.erro);
        }
        
        console.log('\n💡 Para verificar saldo e uso detalhado, acesse:');
        console.log('   https://console.anthropic.com/settings/billing');
        console.log('');
      })
      .catch((err) => {
        console.error("\n❌ Erro:", err.message || err);
        console.log("\n💡 Dica: Verifique se a API Key está correta no .env");
        console.log("   CLAUDE_API_KEY ou ANTHROPIC_API_KEY\n");
        process.exit(1);
      });
      
  } else {
    // Verificar todas as IAs
    verificarTodasIAs()
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        console.error("\n❌ Erro:", err.message || err);
        process.exit(1);
      });
  }
}

module.exports = { 
  verificarQuotaOpenAI,
  verificarQuotaClaude,
  verificarTodasIAs
};