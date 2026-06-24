export const fetchMetrics = async (range) => {

    const response = await fetch(
        `/api/metrics?range=${range}`
    );

    return response.json();

};