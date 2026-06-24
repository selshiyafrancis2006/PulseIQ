import { useEffect } from 'react';

const useWebSocket = (onMessage) => {

    useEffect(() => {

        const ws =
            new WebSocket('ws://localhost:5000');

        ws.onmessage = (event) => {

            const data =
                JSON.parse(event.data);

            onMessage(data);

        };

        return () => ws.close();

    }, [onMessage]);

};

export default useWebSocket;