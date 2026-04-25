import { CheerioAPI, Cheerio } from 'cheerio';

export function extractStructuredContent($: CheerioAPI) {
  const h1: string[] = [];
  const h2: string[] = [];
  const h3: string[] = [];
  const h4: string[] = [];
  const h5: string[] = [];
  const h6: string[] = [];
  const paragraphs: string[] = [];

  // Extract headers from entire document
  $('h1').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1.push(text);
  });

  $('h2').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h2.push(text);
  });

  $('h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h3.push(text);
  });

  $('h4').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h4.push(text);
  });

  $('h5').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h5.push(text);
  });

  $('h6').each((_, el) => {
    const text = $(el).text().trim();
    if (text) h6.push(text);
  });

  // Smart content extraction - target main content areas only
  // Priority selectors for main content
  const contentSelectors = [
    'article',
    'main',
    '[role="main"]',
    '#content',
    '.content',
    '.mw-parser-output', // Wikipedia
    '#mw-content-text', // Wikipedia
    '.post-content',
    '.article-content',
    '#article-content',
    '.entry-content',
    '#bodyContent', // Wikipedia
  ];

  // Find the best content container
  let $contentContainer: Cheerio<any> | null = null;
  for (const selector of contentSelectors) {
    const $el = $(selector);
    if ($el.length > 0) {
      $contentContainer = $el.first();
      break;
    }
  }

  // Extract paragraphs from content container
  if ($contentContainer) {
    // For article tags (news sites), extract from ALL articles, not just first
    if ($contentContainer[0]?.tagName === 'article') {
      $('article').each((_, articleEl) => {
        $(articleEl).find('p').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length > 30 && !isBoilerplateText(text)) {
            paragraphs.push(text);
          }
        });
      });
    } else {
      // For other containers, extract from first match
      $contentContainer.find('p').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 30 && !isBoilerplateText(text)) {
          paragraphs.push(text);
        }
      });
    }
  } else {
    // Fallback: extract from body but exclude common non-content elements
    $('body').children().each((_, el) => {
      const $el = $(el);
      
      // Skip non-content elements
      if ($el.is('nav, footer, header, aside, script, style, noscript')) {
        return;
      }
      
      if ($el.attr('role') === 'navigation' || 
          $el.attr('role') === 'complementary' ||
          $el.attr('role') === 'contentinfo') {
        return;
      }
      
      // Check for common non-content class/id patterns
      const id = $el.attr('id') || '';
      const className = $el.attr('class') || '';
      
      if (id.match(/nav|footer|header|sidebar|aside|advert/i) ||
          className.match(/nav|footer|header|sidebar|aside|advert/i)) {
        return;
      }
      
      $el.find('p').each((_, pEl) => {
        const text = $(pEl).text().trim();
        if (text && text.length > 30 && !isBoilerplateText(text)) {
          paragraphs.push(text);
        }
      });
    });
  }

  return {
    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    paragraphs,
    fullText: '',
  };
}

function isBoilerplateText(text: string): boolean {
  const boilerplatePatterns = [
    /^jump to:?/i,
    /^navigation$/i,
    /^main menu/i,
    /^personal tool/i,
    /^views$/i,
    /^actions$/i,
    /^(search|search this site)/i,
    /^donate/i,
    /^create account|log in|log out/i,
    /^privacy policy|terms of use/i,
    /^about wikipedia|disclaimers/i,
    /^contact us|contact wikipedia/i,
    /^cookie|i agree/i,
    /^developed by|powered by/i,
    /^all text available under/i,
    /^wikipedia® is a registered trademark/i,
    /^this page was last edited/i,
    /^categories?:/i,
    /^hidden categories?:/i,
    /^navigation menu/i,
    /^toggle the table of contents/i,
    /\[\]/, // Edit links
    /^edit(\ssource)?$/i,
    /^from wikipedia, the free encyclopedia/i,
    // Video player and modal text
    /^video player is loading/i,
    /^play video/i,
    /^skip backward|skip forward/i,
    /^current time|duration|stream type/i,
    /^playback rate|fullscreen/i,
    /^this is a modal window/i,
    /^beginning of dialog window/i,
    /^escape will cancel/i,
    /^this modal can be closed/i,
    /^activating the close button/i,
    /^live news and current affairs/i,
    /^unmute|mute|captions/i,
    /^quality levels|audio track/i,
    /^seek to live/i,
    /^error code:/i,
  ];

  const lowerText = text.toLowerCase().slice(0, 100);
  return boilerplatePatterns.some(pattern => pattern.test(lowerText));
}