export function parseMarkdown(content) {
    const imgMatch = content && content.trim().match(/^!\[image\]\((.*?)\)$/);
    const isImage = !!imgMatch;
    const imageUrl = isImage ? imgMatch[1] : '';
    const contentHtml = isImage 
        ? `<img class="chat-inline-photo" src="${imageUrl}" style="max-width: 250px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); cursor: pointer; display: block; margin-top: 4px; border: 2px solid #5d574d;" data-action="open-image" data-url="${imageUrl}" onerror="this.onerror=null; this.outerHTML='<div class=&quot;image-load-failed&quot; style=&quot;padding: 10px 14px; background: #ffebee; color: #d63031; border-radius: 12px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; border: 1.5px solid #5d574d; font-weight: 500;&quot;>⚠️ 이미지를 불러올 수 없습니다.</div>';">`
        : content;
    return { isImage, imageUrl, contentHtml };
}
