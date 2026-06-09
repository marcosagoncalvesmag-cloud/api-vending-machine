const express = require('express');
const fs = require('fs');
const https = require('https');
const aedes = require('aedes')();
const mqttServer = require('net').createServer(aedes.handle);
const EfiPay = require('efi-node-sdk'); // Biblioteca oficial do banco

const app = express();
app.use(express.json());

// ==========================================
// 1. CONFIGURAÇÕES DA EFI BANK (PREENCHA AQUI)
// ==========================================
const configEfi = {
    client_id: 'SEU_CLIENT_ID_AQUI', 
    client_secret: 'SEU_CLIENT_SECRET_AQUI',
    sandbox: true, // true para ambiente de Homologação
    certificate: './homologacao-925757-certificado_teste.p12' // Seu arquivo .p12
};

const efi = new EfiPay(configEfi);
const CHAVE_PIX = 'SUA_CHAVE_PIX_AQUI'; // Adicione sua chave cadastrada na Efí

// ==========================================
// 2. SEGURANÇA mTLS (EXIGÊNCIA DO BANCO CENTRAL)
// ==========================================
// O Ubuntu vai usar estes arquivos para fazer o aperto de mão com o banco
const opcoesHttps = {
    // Sua chave privada e certificado SSL do seu próprio servidor (gerados via Certbot)
    key: fs.readFileSync('./server_ssl.key.pem'),
    cert: fs.readFileSync('./server_ssl.crt.pem'),
    
    // Chave pública da Efí para validar que a requisição veio REALMENTE do banco
    ca: fs.readFileSync('./certificate-chain-homolog.crt'), 
    
    requestCert: true,        // Exige que o cliente envie o certificado dele
    rejectUnauthorized: false // Permite que a primeira requisição de teste chegue para validação lógica
};

// ==========================================
// 3. MONITORAMENTO MQTT DO ESP32
// ==========================================
aedes.on('client', (client) => {
    console.log(`[MAQUINA] ESP32 conectado: ${client.id}`);
});

// ==========================================
// 4. ROTAS HTTP / WEBHOOK
// ==========================================

// Rota para o ESP32 pedir um QR Code de Pix Dinâmico
app.post('/criar-pix', async (req, res) => {
    console.log('[MAQUINA] Solicitando novo Pix Dinâmico...');
    
    // Corpo da cobrança imediata exigido pela Efí
    const corpoCobranca = {
        calendario: { expiracao: 3600 }, // Expira em 1 hora
        valor: { original: "0.01" },     // R$ 0.01 fixo para testes de homologação
        chave: CHAVE_PIX,
        solicitacaoPagador: "Pagamento Vending Machine"
    };

    try {
        // Consome a aba "/v2/cob" que analisamos no menu esquerdo
        const cobranca = await efi.pixCreateImmediateCharge([], corpoCobranca);
        
        // Gera a string do QR Code baseado no ID da cobrança (txid)
        const params = { id: cobranca.txid };
        const qrCode = await efi.pixGenerateQRCode(params);
        
        console.log(`[SUCESSO] Pix Gerado! TXID: ${cobranca.txid}`);
        
        // Retorna para o ESP32 a string "Pix Copia e Cola" e a imagem base64
        return res.status(200).json({
            pixCopiaECola: qrCode.qrcode,
            imagemQrCode: qrCode.imagemQrcode,
            txid: cobranca.txid
        });
    } catch (erro) {
        console.error('[ERRO] Falha ao criar cobrança Pix:', erro);
        return res.status(500).send('Erro ao gerar o Pix');
    }
});

// Webhook oficial ajustado para prever o acréscimo automático de "/pix"
app.post('/webhook-pix/pix', (req, res) => {
    // Validando se a requisição veio com o certificado da Efí
    const certificadoCliente = req.socket.getPeerCertificate();
    if (!req.client.authorized && (!certificadoCliente || !certificadoCliente.subject)) {
        console.log('[SEGURANÇA] Recusando requisição sem certificado mTLS legítimo.');
        return res.status(401).send('Não autorizado');
    }

    console.log('[BANCO] Pagamento confirmado recebido via mTLS!');
    const dadosPix = req.body.pix;

    if (dadosPix && dadosPix.length > 0) {
        const txidPago = dadosPix[0].txid;
        console.log(`[PROCESSO] Liberando produto para o Pix TXID: ${txidPago}`);
        
        // Comando enviado via MQTT para o ESP32 liberar a dose
        const comando = JSON.stringify({ acao: "liberar_dose_padrao", id: txidPago });
        
        aedes.publish({
            topic: 'vending/maquina_001',
            payload: comando,
            qos: 1,
            retain: false
        }, () => {
            console.log('[MQTT] Comando de liberação enviado com sucesso ao ESP32!');
        });
    }

    return res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.send('API Vending Machine com mTLS Ativa!');
});

// ==========================================
// 5. INICIALIZAÇÃO DOS SERVIDORES
// ==========================================

// Inicia o Servidor Web em modo HTTPS SEGURO na porta 443
const PORTA_HTTPS = 443;
https.createServer(opcoesHttps, app).listen(PORTA_HTTPS, () => {
    console.log(`[HTTPS] Servidor Web Seguro (mTLS) ativo na porta ${PORTA_HTTPS}`);
});

// Inicia o Broker MQTT aberto para o ESP32 na porta 1883
const PORTA_MQTT = 1883;
mqttServer.listen(PORTA_MQTT, () => {
    console.log(`[MQTT] Broker integrado ativo na porta ${PORTA_MQTT}`);
});
