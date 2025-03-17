import puppeteer, { Page } from 'puppeteer';

// Add waitForTimeout to the Page interface
declare module 'puppeteer' {
  interface Page {
    waitForTimeout(milliseconds: number): Promise<void>;
  }
}

/**
 * Script to analyze Ryanair page structure for better selectors
 */
async function analyzeRyanairStructure() {
  const url = 'https://www.ryanair.com/gb/en/trip/flights/select?adults=2&teens=2&children=0&infants=0&dateOut=2025-08-22&dateIn=&isConnectedFlight=false&discount=0&promoCode=&isReturn=false&originIata=BUD&destinationIata=MAN';
  
  const browser = await puppeteer.launch({
    headless: false, // Non-headless for debugging
    defaultViewport: { width: 1366, height: 768 }
  });
  
  try {
    console.log('Opening browser...');
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    
    // Navigate to the URL
    console.log('Navigating to Ryanair...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Accept cookies if dialog appears
    try {
      const cookieSelector = 'button[data-ref="cookie.accept-all"]';
      await page.waitForSelector(cookieSelector, { timeout: 5000 });
      await page.click(cookieSelector);
      console.log('Accepted cookies');
    } catch (error) {
      console.log('No cookie dialog found or already accepted');
    }
    
    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'ryanair-debug.png' });
    console.log('Saved screenshot as ryanair-debug.png');
    
    // Extract date items
    console.log('\n==== DATE ITEMS ====');
    const dateItems = await page.evaluate(() => {
      const items = document.querySelectorAll('.date-item');
      console.log(`Found ${items.length} date items`);
      
      return Array.from(items).map(item => {
        // Get HTML structure
        const html = item.outerHTML.substring(0, 300);
        
        // Get text content
        const text = item.textContent?.trim();
        
        // Get class names
        const className = item.className;
        
        // Check if selected
        const isSelected = item.classList.contains('date-item--selected');
        
        // Get price
        const priceEl = item.querySelector('.date-item__price');
        const price = priceEl ? priceEl.textContent?.trim() : 'No price found';
        
        // Get day
        const dayEl = item.querySelector('.date-item__day-of-month');
        const day = dayEl ? dayEl.textContent?.trim() : 'No day found';
        
        // Get month
        const monthEl = item.querySelector('.date-item__month');
        const month = monthEl ? monthEl.textContent?.trim() : 'No month found';
        
        // Get weekday
        const weekdayEl = item.querySelector('.date-item__day-of-week');
        const weekday = weekdayEl ? weekdayEl.textContent?.trim() : 'No weekday found';
        
        return { html, text, className, isSelected, price, day, month, weekday };
      });
    });
    
    console.log(`Found ${dateItems.length} date items`);
    if (dateItems.length > 0) {
      console.log('First date item:', JSON.stringify(dateItems[0], null, 2));
      
      // Log selected date
      const selectedDate = dateItems.find(item => item.isSelected);
      if (selectedDate) {
        console.log('Selected date:', JSON.stringify(selectedDate, null, 2));
      }
    }
    
    // Extract flight cards
    console.log('\n==== FLIGHT CARDS ====');
    const flightCards = await page.evaluate(() => {
      // Try various selectors for flight cards
      const cardSelectors = [
        '[data-e2e="flight-card"]',
        '.flight-card',
        '.card',
        '.journey-container',
        '.flights-card',
        '[data-ref="flight-card"]',
        '.flights-table__row',
        '.flight-header'
      ];
      
      // Try each selector
      let cards: Element[] = [];
      let foundSelector = '';
      
      for (const selector of cardSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          cards = Array.from(elements);
          foundSelector = selector;
          break;
        }
      }
      
      console.log(`Found ${cards.length} flight cards using selector: ${foundSelector}`);
      
      if (cards.length === 0) {
        // Look for any element containing flight-related text
        const allElements = document.querySelectorAll('*');
        const flightElements = Array.from(allElements).filter(el => {
          const text = el.textContent?.toLowerCase() || '';
          return (text.includes('flight') || text.includes('depart') || text.includes('arrive')) && 
                 el.tagName !== 'BODY' && el.tagName !== 'HTML';
        });
        
        console.log(`Found ${flightElements.length} elements with flight-related text`);
        
        if (flightElements.length > 0) {
          // Return info about the first 3 elements
          return flightElements.slice(0, 3).map(el => {
            return {
              tagName: el.tagName,
              className: el.className,
              id: el.id,
              html: el.outerHTML.substring(0, 300),
              text: el.textContent?.trim(),
              rect: JSON.stringify(el.getBoundingClientRect())
            };
          });
        }
        
        return [];
      }
      
      // Return information about the cards
      return cards.map(card => {
        // Get all child elements to analyze structure
        const children = Array.from(card.children);
        
        // Extract time information
        const times = Array.from(card.querySelectorAll('.time, [class*="time"], .hour, [class*="hour"]'));
        const timeInfo = times.map((t: Element) => ({ 
          text: t.textContent?.trim(),
          className: t.className
        }));
        
        // Extract price information
        const priceElements = Array.from(card.querySelectorAll('.price, [class*="price"], .fare, [class*="fare"], .amount, [class*="amount"]'));
        const priceInfo = priceElements.map((p: Element) => ({ 
          text: p.textContent?.trim(),
          className: p.className
        }));
        
        // Extract flight number information
        const flightNumElements = Array.from(card.querySelectorAll('.flight-number, [class*="flight-number"], [class*="code"], .number, [class*="number"]'));
        const flightNumInfo = flightNumElements.map((f: Element) => ({ 
          text: f.textContent?.trim(),
          className: f.className
        }));
        
        return {
          html: card.outerHTML.substring(0, 300),
          text: card.textContent?.trim().substring(0, 100),
          className: card.className,
          childCount: children.length,
          timeElements: timeInfo,
          priceElements: priceInfo,
          flightNumberElements: flightNumInfo
        };
      });
    });
    
    console.log(`Found ${flightCards.length} flight cards`);
    if (flightCards.length > 0) {
      console.log('First flight card:', JSON.stringify(flightCards[0], null, 2));
    }
    
    // Look for general flight information on the page
    console.log('\n==== FLIGHT INFORMATION ====');
    const flightInfo = await page.evaluate(() => {
      // Get route information
      const routeSelector = '.flight-header__route, .trip-header__route, .flight-header__title';
      const routeEl = document.querySelector(routeSelector);
      const route = routeEl ? routeEl.textContent?.trim() : 'No route found';
      
      // Get date information
      const dateSelector = '.flight-header__date, .trip-header__date';
      const dateEl = document.querySelector(dateSelector);
      const date = dateEl ? dateEl.textContent?.trim() : 'No date found';
      
      // Get passenger information
      const passengerSelector = '.flight-header__passenger-number, .trip-header__passengers';
      const passengerEl = document.querySelector(passengerSelector);
      const passengers = passengerEl ? passengerEl.textContent?.trim() : 'No passenger info found';
      
      // Get price information from the page (not from individual cards)
      const priceSelector = '.flight-header__min-price, .trip-header__price, .price-total';
      const priceEl = document.querySelector(priceSelector);
      const price = priceEl ? priceEl.textContent?.trim() : 'No price found';
      
      // Get a full page snapshot of just text for debugging
      const bodyText = document.body.textContent?.trim().substring(0, 500);
      
      return { route, date, passengers, price, bodyText };
    });
    
    console.log('Flight Information:', JSON.stringify(flightInfo, null, 2));
    
    return {
      dateItems,
      flightCards,
      flightInfo
    };
  } catch (error) {
    console.error('An error occurred:', error);
    throw error;
  } finally {
    // Keep browser open for a moment to check
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
    console.log('Browser closed.');
  }
}

// Run the analysis
analyzeRyanairStructure().catch(console.error);