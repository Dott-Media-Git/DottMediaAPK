export async function publishToTwitter(input) {
    console.info('[twitter] posting', input.caption.slice(0, 40));
    // TODO: integrate Twitter/X API with OAuth once credentials available.
    await new Promise(resolve => setTimeout(resolve, 50));
    return { remoteId: `tw_${Date.now()}` };
}
