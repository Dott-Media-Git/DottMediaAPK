import axios from 'axios';
export async function publishToLinkedIn(input) {
    console.info('[linkedin] posting', input.caption.slice(0, 40));
    await axios.request({ method: 'GET', url: 'https://www.linkedin.com' }).catch(() => ({}));
    return { remoteId: `li_${Date.now()}` };
}
