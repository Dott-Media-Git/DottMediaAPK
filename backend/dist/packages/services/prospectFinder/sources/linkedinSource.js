import axios from 'axios';
/**
 * Stubbed LinkedIn discovery with hooks for REST/Puppeteer integrations.
 */
export async function searchLinkedInProspects(params) {
    const hasApiAccess = Boolean(process.env.LINKEDIN_ACCESS_TOKEN);
    if (hasApiAccess) {
        try {
            const results = await queryLinkedInApi(params);
            if (results.length)
                return results;
        }
        catch (error) {
            console.warn('LinkedIn API lookup failed, falling back to mock data', error);
        }
    }
    return mockLinkedInProspects(params);
}
async function queryLinkedInApi(params) {
    if (!process.env.LINKEDIN_ACCESS_TOKEN)
        return [];
    const token = process.env.LINKEDIN_ACCESS_TOKEN;
    const query = params.keyword ?? params.industry;
    if (!query)
        return [];
    const url = `https://api.linkedin.com/v2/search?q=keyword&query=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
    const elements = response.data?.elements ?? [];
    return elements.slice(0, params.limit ?? 25).map((element, index) => ({
        id: `li-${element['id'] ?? index}`,
        name: (element['firstName'] && element['lastName'] ? `${element['firstName']} ${element['lastName']}` : element['name']) ?? 'LinkedIn Prospect',
        company: element['companyName'] ?? element['headline']?.toString()?.split(' at ')[1],
        position: element['headline'] ?? 'Leader',
        industry: params.industry,
        location: element['locationName'] ?? params.country,
        profileUrl: element['publicProfileUrl'],
        channel: 'linkedin',
    }));
}
function mockLinkedInProspects(params) {
    const industry = params.industry ?? 'AI';
    return [
        {
            id: `mock-li-${industry.toLowerCase()}-1`,
            name: 'Aisha Kintu',
            company: 'Kampala Realty Hub',
            position: 'Growth Director',
            industry,
            email: 'aisha.kintu+li@kampalarealty.com',
            profileUrl: 'https://linkedin.com/in/aishakintu',
            location: params.country ?? 'Uganda',
            channel: 'linkedin',
        },
        {
            id: `mock-li-${industry.toLowerCase()}-2`,
            name: 'Javier Mendez',
            company: 'Skyline Estates',
            position: 'Sales Manager',
            industry,
            email: 'javier@skylineestates.co',
            profileUrl: 'https://linkedin.com/in/javiermendez',
            location: 'Colombia',
            channel: 'linkedin',
        },
    ];
}
