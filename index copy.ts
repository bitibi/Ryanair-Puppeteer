import puppeteer, { EvaluateFunc, Page } from 'puppeteer';

// Add waitForTimeout to the Page interface
declare module 'puppeteer' {
  interface Page {
    waitForTimeout(milliseconds: number): Promise<void>;
  }
}

interface DatePrice {
  date: string;
  weekday: string;
  price: string;
  currency: string;
  isSelected: boolean;
}

interface FlightData {
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  price: string;
  currency: string;
  duration: string;
  fromAirport: string;
  toAirport: string;
}

interface FlightPriceResult {
  flights: FlightData[];
  datePrices: DatePrice[];
}

/**
 * Check flight prices from Ryanair website using a direct URL
 * @param origin Origin airport code (e.g., 'BUD' for Budapest)
 * @param destination Destination airport code (e.g., 'MAN' for Manchester)
 * @param date Date in 'YYYY-MM-DD' format
 * @param adults Number of adults (default: 1)
 * @param teens Number of teens (default: 0)
 * @param children Number of children (default: 0)
 * @param infants Number of infants (default: 0)
 * @returns Price information for the specified flight
 */
async function checkRyanairPrice(
  origin: string,
  destination: string,
  date: string,
  adults: number = 1,
  teens: number = 0,
  children: number = 0,
  infants: number = 0
): Promise<FlightPriceResult> {
  // Construct the direct URL with all parameters
  const directUrl = `https://www.ryanair.com/gb/en/trip/flights/select?adults=${adults}&teens=${teens}&children=${children}&infants=${infants}&dateOut=${date}&dateIn=&isConnectedFlight=false&discount=0&promoCode=&isReturn=false&originIata=${origin}&destinationIata=${destination}&tpAdults=${adults}&tpTeens=${teens}&tpChildren=${children}&tpInfants=${infants}&tpStartDate=${date}&tpEndDate=&tpDiscount=0&tpPromoCode=&tpOriginIata=${origin}&tpDestinationIata=${destination}`;

  // Launch browser with some recommended options
  const browser = await puppeteer.launch({
    headless: false, // Set to true in production
    defaultViewport: null,
    args: ['--start-maximized', '--disable-notifications', '--no-sandbox']
  });

  try {
    console.log('Opening browser...');
    const page = await browser.newPage();

    // Set timeout to 60 seconds for page navigations
    page.setDefaultNavigationTimeout(60000);
    
    // Add user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Navigate directly to the flight selection page
    console.log(`Navigating to flight selection page for ${origin} to ${destination} on ${date}...`);
    await page.goto(directUrl, { waitUntil: 'networkidle2' });

    // Accept cookies if the dialog appears
    try {
      console.log('Checking for cookie consent dialog...');
      const cookieSelector = 'button[data-ref="cookie.accept-all"]';
      await page.waitForSelector(cookieSelector, { timeout: 5000 });
      await page.click(cookieSelector);
      console.log('Accepted cookies');
    } catch (error) {
      console.log('No cookie dialog found or already accepted');
    }

    // Use setTimeout instead of waitForTimeout (which might not exist in your Puppeteer version)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for prices to load
    console.log('Waiting for prices to load...');
    await page.waitForSelector('.date-item__price', { timeout: 30000 });
    
    // Extract date-based prices
    console.log('Extracting date prices...');
    const datePrices: DatePrice[] = await page.evaluate(() => {
      const dateItems = document.querySelectorAll('.date-item');
      return Array.from(dateItems).map(item => {
        const isSelected = item.classList.contains('date-item--selected');
        
        // Extract full date information - day number + month
        const dayElement = item.querySelector('.date-item__day-of-month');
        const day = dayElement ? dayElement.textContent?.trim() || '' : '';
        
        // Extract month
        const monthElement = item.querySelector('.date-item__month');
        const month = monthElement ? monthElement.textContent?.trim() || '' : '';
        
        // Combine for a readable date
        const date = `${day} ${month}`;
        
        // Extract weekday
        const weekdayElement = item.querySelector('.date-item__day-of-week');
        const weekday = weekdayElement ? weekdayElement.textContent?.trim() || '' : '';
        
        // Extract price and currency
        const priceElement = item.querySelector('.date-item__price');
        const priceText = priceElement ? priceElement.textContent?.trim() || 'N/A' : 'N/A';
        const priceMatch = priceText.match(/[\d,.]+/);
        const currencyMatch = priceText.match(/[^\d\s,.]+/);
        const price = priceMatch ? priceMatch[0] : 'N/A';
        const currency = currencyMatch ? currencyMatch[0] : 'N/A';
        
        return {
          date,
          weekday,
          price,
          currency,
          isSelected
        };
      });
    });
    
    // Extract specific time options for the selected date
    console.log('Extracting specific time options for the selected date...');
    const timeOptions: any[] = await page.evaluate(() => {
      // Try to find all time slots available for the selected date
      const timeSlots = Array.from(document.querySelectorAll('.flight-header__min-price, .flight-info, .journey-info'));
      return timeSlots.map(slot => {
        // Try to get departure/arrival times
        const times = slot.querySelectorAll('.flight-info__hour');
        const departureTime = times[0]?.textContent?.trim() || 'N/A';
        const arrivalTime = times[1]?.textContent?.trim() || 'N/A';

        // Try to get departure/arrival cities
        const cities = slot.querySelectorAll('.flight-info__city');
        const fromCity = cities[0]?.textContent?.trim() || 'N/A';
        const toCity = cities[1]?.textContent?.trim() || 'N/A';
        
        // Try to get price
        const priceElement = slot.querySelector('.price, .amount, .fare');
        const price = priceElement ? priceElement.textContent?.trim() : 'N/A';
        
        // Try to get flight number
        const flightElement = slot.querySelector('.card-flight-num__content');
        const flightNumber = flightElement ? flightElement.textContent?.trim() : 'N/A';
        
        return { departureTime, arrivalTime, price, flightNumber, fromCity, toCity };
      });
    });
    
    if (timeOptions && timeOptions.length > 0) {
      console.log(`Found ${timeOptions.length} specific time options for the selected date`);
      console.table(timeOptions);
    }
    
    // Extract available flights for the selected date
    console.log('Extracting flight details...');
    let flights: FlightData[] = await page.evaluate(((destination: string, origin: string) => {
      // Try different selectors for flight cards
      const flightCards = Array.from(document.querySelectorAll('[data-e2e="flight-card"], .flight-card, .card-flight'));
      
      return flightCards.map(card => {
        // Extract times - try multiple selector patterns
        const departureTime = card.querySelector('[data-ref="flight-segment.departure"] .flight-info__hour')?.textContent?.trim() || 'N/A';
        const arrivalTime = card.querySelector('[data-ref="flight-segment.arrival"] .flight-info__hour')?.textContent?.trim() || 'N/A';
        
        // Extract flight number
        const flightNumber = card.querySelector('.card-flight-num__content')?.textContent?.trim() || 'N/A';
        
        // Extract price
        const priceElement = card.querySelector('[data-e2e="flight-card-price"], .flight-card__price, .card-flight__price, .price');
        let price = 'N/A';
        if (priceElement) {
          price = priceElement.textContent?.trim() || 'N/A';
        }
        
        // Extract currency and price separately
        const currencyMatch = price.match(/[^\d\s,.]+/);
        const currency = currencyMatch ? currencyMatch[0] : '';
        
        // Extract duration if available
        const duration = card.querySelector('[data-ref="flight_duration"], .flight-card__duration, .card-flight__duration, .flight-time')?.textContent?.trim() || 'N/A';
        
        return {
          flightNumber,
          departureTime,
          arrivalTime,
          price,
          currency,
          duration,
          fromAirport: origin,
          toAirport: destination
        };
      });
    }) as EvaluateFunc<[string, string]>, destination, origin) as FlightData[];
    
    // Try a different approach if we still don't have flight info
    if (flights.length === 0) {
      console.log('Trying alternative selectors for flight information...');
      
      // Take a screenshot of the current page state for debugging
      await page.screenshot({ path: 'ryanair-debug.png' });
      
      // Try a more aggressive approach to find flight cards
      const moreFlights: any[] = await page.evaluate(() => {
        // Check for various flight containers
        const allFlightContainers = Array.from(document.querySelectorAll('div[class*="flight"], div[class*="card"], tr[class*="flight"], div[class*="journey"]'));
        console.log(`Found ${allFlightContainers.length} potential flight containers`);
        
        // Function to extract text from an element safely
        const getText = (container: Element, selector: string) => {
          const element = container.querySelector(selector);
          return element ? element.textContent?.trim() : null;
        };
        
        // Function to extract text using a list of possible selectors
        const getTextMultiSelector = (container: Element, selectors: string[]) => {
          for (const selector of selectors) {
            const text = getText(container, selector);
            if (text) return text;
          }
          return 'N/A';
        };
        
        return allFlightContainers.map(container => {
          // Try to identify if this is a flight card by looking for time, price, or flight number
          const timeSelectors = ['[class*="time"]', '[class*="hour"]', 'strong', '.bold'];
          const priceSelectors = ['[class*="price"]', '[class*="amount"]', '[class*="fare"]'];
          const flightNumberSelectors = ['[class*="flight-number"]', '[class*="number"]', '[class*="code"]'];
          
          const hasTime = container.querySelector(timeSelectors.join(','));
          const hasPrice = container.querySelector(priceSelectors.join(','));
          
          // If it has both time and price elements, it's likely a flight card
          if (hasTime && hasPrice) {
            // Extract departure and arrival times
            const times = Array.from(container.querySelectorAll(timeSelectors.join(',')));
            const departureTime = times[0]?.textContent?.trim() || 'N/A';
            const arrivalTime = times.length > 1 ? times[1]?.textContent?.trim() : 'N/A';
            
            // Extract price 
            const price = getTextMultiSelector(container, priceSelectors);
            
            // Extract flight number
            const flightNumber = getTextMultiSelector(container, flightNumberSelectors);
            
            // Extract airports if available
            const airportSelectors = ['[class*="airport"]', '[class*="station"]', '[class*="code"]'];
            const airports = Array.from(container.querySelectorAll(airportSelectors.join(',')));
            const fromAirport = airports[0]?.textContent?.trim() || 'N/A';
            const toAirport = airports.length > 1 ? airports[1]?.textContent?.trim() : 'N/A';
            
            // Extract duration
            const durationSelectors = ['[class*="duration"]', '[class*="time"]', '[class*="length"]'];
            const duration = getTextMultiSelector(container, durationSelectors);
            
            // Extract currency
            const currencyMatch = price.match(/[^\d\s,.]+/);
            const currency = currencyMatch ? currencyMatch[0] : '';
            
            return {
              flightNumber,
              departureTime,
              arrivalTime,
              price,
              currency,
              duration,
              fromAirport,
              toAirport,
              containerText: container.textContent?.trim().substring(0, 100) // For debugging
            };
          }
          return null;
        }).filter(item => item !== null);
      });
      
      if (moreFlights && moreFlights.length > 0) {
        console.log(`Found ${moreFlights.length} flights using alternative selectors`);
        flights.push(...moreFlights);
      }
    }
    
    // If no specific flight cards were found, use the selected date price
    if (flights.length === 0 && datePrices.length > 0) {
      const selectedDatePrice = datePrices.find(item => item.isSelected);
      if (selectedDatePrice) {
        console.log(`No specific flights found, but selected date price is ${selectedDatePrice.price}`);
        
        // Try to find more details on the page
        const additionalInfo = await page.evaluate(() => {
          // Try to extract route
          const routeElement = document.querySelector('.flight-header__route, .route-title');
          const route = routeElement ? routeElement.textContent?.trim() : '';
          
          // Try to extract direct flight info
          const directElement = document.querySelector('.flight-header__stops, .flight-header__direct');
          const directInfo = directElement ? directElement.textContent?.trim() : '';
          
          // Try to get date info
          const dateElement = document.querySelector('.flight-header__date');
          const dateInfo = dateElement ? dateElement.textContent?.trim() : '';
          
          // Try to get airport codes
          const fromElement = document.querySelector('.flight-header__airport-code--from, .airport-code:first-child');
          const toElement = document.querySelector('.flight-header__airport-code--to, .airport-code:last-child');
          const fromAirport = fromElement ? fromElement.textContent?.trim() : '';
          const toAirport = toElement ? toElement.textContent?.trim() : '';
          
          return { route, directInfo, dateInfo, fromAirport, toAirport };
        });
        
        // Create a generic flight entry with the date price and any additional info
        flights.push({
          flightNumber: additionalInfo.directInfo || 'Direct',
          departureTime: 'Check website',
          arrivalTime: 'Check website',
          price: selectedDatePrice.price,
          currency: selectedDatePrice.price.replace(/[\d\s,.]+/g, ''),
          duration: 'Check website',
          fromAirport: additionalInfo.fromAirport || origin,
          toAirport: additionalInfo.toAirport || destination
        });
      }
    }
    
    // Use time options if we found them but didn't get detailed flight info
    if (flights.length === 1 && flights[0].departureTime === 'Check website' && timeOptions.length > 0) {
      // We only have a generic flight entry, let's replace it with more specific ones
      flights = []; // Clear the array
      
      // Convert time options to flight data
      timeOptions.forEach((option: any) => {
        flights.push({
          flightNumber: option.flightNumber || 'Direct flight',
          departureTime: option.departureTime,
          arrivalTime: option.arrivalTime,
          price: option.price,
          currency: option.price.replace(/[\d\s,.]+/g, '') || 'Ft',
          duration: 'See website',
          fromAirport: origin,
          toAirport: destination
        });
      });
    }
    
    console.log(`Found ${flights.length} flights for ${origin} to ${destination} on ${date}`);
    console.log(`Date prices for nearby dates: ${datePrices.length} found`);
    
    return {
      flights,
      datePrices
    };
  } catch (error) {
    console.error('An error occurred:', error);
    throw error;
  } finally {
    // Close the browser
    await browser.close();
    console.log('Browser closed.');
  }
}

// Example usage with command line arguments
async function main() {
  try {
    // Use command line arguments or default values
    const origin = process.argv[2] || 'BUD';         // Budapest
    const destination = process.argv[3] || 'MAN';    // Manchester
    const date = process.argv[4] || '2025-08-22';    // Date format: YYYY-MM-DD
    const adults = parseInt(process.argv[5] || '2'); // Number of adults
    const teens = parseInt(process.argv[6] || '2');  // Number of teens
    const children = parseInt(process.argv[7] || '0'); // Number of children
    const infants = parseInt(process.argv[8] || '0'); // Number of infants
    
    console.log(`Checking flights from ${origin} to ${destination} on ${date} for ${adults} adults, ${teens} teens, ${children} children, and ${infants} infants`);
    const flightData = await checkRyanairPrice(origin, destination, date, adults, teens, children, infants);
    
    // Display the results
    console.log('\nFlight Prices:');
    console.table(flightData.flights);
    
    console.log('\nPrices for nearby dates:');
    console.table(flightData.datePrices);
    
    // Find the cheapest flight
    if (flightData.flights.length > 0) {
      const cheapestFlight = flightData.flights.reduce((min: FlightData, flight: FlightData) => {
        // Extract numeric value from price string
        const getPriceNumeric = (price: string) => {
          const matches = price.match(/[\d,.]+/);
          return matches ? parseFloat(matches[0].replace(/,/g, '')) : Infinity;
        };
        
        const priceA = getPriceNumeric(min.price);
        const priceB = getPriceNumeric(flight.price);
        return priceA < priceB ? min : flight;
      });
      
      console.log(`\nCheapest flight: ${cheapestFlight.flightNumber}`);
      console.log(`Price: ${cheapestFlight.price}`);
      console.log(`Route: ${cheapestFlight.fromAirport} to ${cheapestFlight.toAirport}`);
      console.log(`Departure: ${cheapestFlight.departureTime}, Arrival: ${cheapestFlight.arrivalTime}`);
      console.log(`Duration: ${cheapestFlight.duration}`);
    } else {
      console.log('No flights found for this date.');
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the script
main().catch(console.error);