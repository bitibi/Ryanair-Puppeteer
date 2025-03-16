import puppeteer from 'puppeteer';

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
interface DatePrice {
  date: string;
  day: string;
  price: string;
  isSelected: boolean;
}

interface FlightData {
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  price: string;
  currency: string;
  duration: string;
}

interface FlightPriceResult {
  flights: FlightData[];
  datePrices: DatePrice[];
}

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

    // Wait for prices to load
    console.log('Waiting for prices to load...');
    await page.waitForSelector('.date-item__price', { timeout: 30000 });
    
    // Extract date-based prices
    console.log('Extracting date prices...');
    const datePrices = await page.evaluate(() => {
      const dateItems = document.querySelectorAll('.date-item');
      return Array.from(dateItems).map(item => {
        const isSelected = item.classList.contains('date-item--selected');
        const date = item.querySelector('.date-item__day-month')?.textContent?.trim() || '';
        const day = item.querySelector('.date-item__day')?.textContent?.trim() || '';
        const price = item.querySelector('.date-item__price')?.textContent?.trim() || 'N/A';
        
        return {
          date,
          day,
          price,
          isSelected
        };
      });
    });
    
    // We've moved the FlightData interface to the top level
    
    // Extract available flights for the selected date
    console.log('Extracting flight details...');
    const flights: FlightData[] = await page.evaluate(() => {
      // Try different selectors for flight cards
      const flightCards = Array.from(document.querySelectorAll('[data-e2e="flight-card"], .flight-card'));
      
      return flightCards.map(card => {
        // Extract times
        const departureTime = card.querySelector('[data-e2e="flight-card-departure-time"], .flight-card__departure-time')?.textContent?.trim() || 'N/A';
        const arrivalTime = card.querySelector('[data-e2e="flight-card-arrival-time"], .flight-card__arrival-time')?.textContent?.trim() || 'N/A';
        
        // Extract flight number
        const flightNumber = card.querySelector('[data-e2e="flight-card-flight-number"], .flight-card__flight-number')?.textContent?.trim() || 'N/A';
        
        // Extract price
        const priceText = card.querySelector('[data-e2e="flight-card-price"], .flight-card__price')?.textContent?.trim() || 'N/A';
        
        // Extract currency and price separately
        const currencyMatch = priceText.match(/[^\d\s,.]+/);
        const currency = currencyMatch ? currencyMatch[0] : '';
        const price = priceText;
        
        // Extract duration if available
        const duration = card.querySelector('[data-e2e="flight-card-duration"], .flight-card__duration')?.textContent?.trim() || 'N/A';
        
        return {
          flightNumber,
          departureTime,
          arrivalTime,
          price,
          currency,
          duration
        };
      });
    });
    
    // If no specific flight cards were found, use the selected date price
    if (flights.length === 0 && datePrices.length > 0) {
      const selectedDatePrice = datePrices.find(item => item.isSelected);
      if (selectedDatePrice) {
        console.log(`No specific flights found, but selected date price is ${selectedDatePrice.price}`);
        // Create a generic flight entry with the date price
        flights.push({
          flightNumber: 'N/A',
          departureTime: 'N/A',
          arrivalTime: 'N/A',
          price: selectedDatePrice.price,
          currency: selectedDatePrice.price.replace(/[\d\s,.]+/g, ''),
          duration: 'N/A'
        });
      }
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
    const adults = parseInt(process.argv[5] || '1'); // Number of adults
    const teens = parseInt(process.argv[6] || '0');  // Number of teens
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