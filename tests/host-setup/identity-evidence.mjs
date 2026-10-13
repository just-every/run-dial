// Geometry is recorded for each mode so a parent viewport is never mistaken for
// the actual layout viewport inside an intrinsically sized iframe.
export async function identityEvidence(page, response, title) {
  const iframe = page.locator("iframe");
  const frame = await (await iframe.elementHandle()).contentFrame();
  return {
    parentViewport: page.viewportSize(),
    response: { status: response.status(), url: response.url() },
    iframe: await iframe.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), clientWidth: node.clientWidth, clientHeight: node.clientHeight })),
    document: await frame.evaluate(title => {
      const geometry = node => { const style = globalThis.getComputedStyle(node); return { tag: node.tagName, class: node.className, rect: node.getBoundingClientRect().toJSON(), display: style.display, visibility: style.visibility }; };
      return { innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight, titleNodes: [...globalThis.document.querySelectorAll("body *")].filter(node => node.childElementCount === 0 && node.textContent.trim() === title).map(node => {
        const ancestors = []; for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(geometry(parent));
        return { ...geometry(node), text: node.textContent, ancestors };
      }) };
    }, title),
  };
}
