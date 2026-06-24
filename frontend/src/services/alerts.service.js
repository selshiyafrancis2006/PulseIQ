export const fetchAlerts = async () => {

    const response =
        await fetch('/api/alerts');

    return response.json();

};