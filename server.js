const express = require('express');
const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
const app = express();

app.use(express.json());

const HTTP_PORT = process.env.PORT || 3000;
const MQTT_PORT = 1883;

// Monitoramento do ESP32 via MQTT
aedes.on('client', (client) => {
    console.log(`[MAQUINA] ESP32 conectado: ${client.id}`);
});

// Webhook onde o Banco vai avisar o pagamento
app.post('/webhook-pix', (appReq, appRes) => {
    console.log('[BANCO] Pagamento recebido!');
    
    // Comando enviado para o ESP32 liberar a dose
    const comando = JSON.stringify({ acao: "liberar_dose_padrao" });
    
    aedes.publish({
        topic: 'vending/maquina_001',
        payload: comando,
        qos: 1,
        retain: false
    }, () => {
        console.log('[SUCESSO] Comando enviado para o ESP32!');
    });

    return appRes.status(200).send('OK');
});

app.get('/', (appReq, appRes) => {
    appRes.send('API da Vending Machine ativa!');
});

app.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Servidor Web na porta ${HTTP_PORT}`);
});

server.listen(MQTT_PORT, () => {
    console.log(`[MQTT] Broker integrado na porta ${MQTT_PORT}`);
});
