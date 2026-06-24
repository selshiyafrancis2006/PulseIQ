let wss;

function setWSS(serverWSS) {

    wss = serverWSS;

}

function broadcastMetrics(data) {

    if (!wss) {

        console.log(
            'WebSocket server not initialized'
        );

        return;

    }

    wss.clients.forEach((client) => {

        if (client.readyState === 1) {

            client.send(
                JSON.stringify(data)
            );

        }

    });

}

module.exports = {
    setWSS,
    broadcastMetrics
};