import API_BASE from './api';

export const fetchSystemInfo = async () => {

    const res = await fetch(
        `${API_BASE}/system-info`
    );

    return res.json();

};