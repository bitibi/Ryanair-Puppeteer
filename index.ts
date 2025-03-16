import puppeteer, { Page } from 'puppeteer';

/**
 * Check flight prices from Ryanair website
 * @param origin Origin airport code (e.g., 'BUD' for Budapest)
 * @param destination Destination airport code (e.g., 'MAN' for Manchester)
 * @param date Date in 'YYYY-MM-DD' format
 * @returns Price information for the specified flight
 */
async function checkRyanairPrice(
    origin: string,
    destination: string,
    date: string
): Promise<any[]> {
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

        // Navigate to Ryanair website
        console.log('Navigating to Ryanair website...');
        await page.goto('https://www.ryanair.com/gb/en', { waitUntil: 'networkidle2' });

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

        // Fill in the origin
        console.log(`Setting origin to ${origin}...`);
        await page.waitForSelector('input[id="input-button__departure"]', { visible: true });
        await page.click('input[id="input-button__departure"]');

        // Clear the field before typing (triple-click to select all text and delete)
        await page.click('input[id="input-button__departure"]', { clickCount: 3 });
        await page.keyboard.press('Backspace'); 
        await page.type('input[id="input-button__departure"]', origin); // Type BUD
        // Simply press Tab to select the first matching option
        await page.keyboard.press('Tab');

        // Fill in the destination
        console.log(`Setting destination to ${destination}...`);
        await page.waitForSelector('input[id="input-button__destination"]', { visible: true });
        await page.click('input[id="input-button__destination"]');

        // Clear the field before typing (triple-click to select all text and delete)
        await page.click('input[id="input-button__destination"]', { clickCount: 3 });
        await page.keyboard.press('Backspace');

        await page.type('input[id="input-button__destination"]', destination);

        // Wait for dropdown and select the first option
        await page.waitForSelector('.b2.airport-item', { visible: true });
        await page.click('.b2.airport-item');

        // Click on date input field
        console.log('Opening date picker...');
        await page.waitForSelector('[data-ref="flight-search-date-picker__input"]', { visible: true });
        await page.click('[data-ref="flight-search-date-picker__input"]');

        // Parse the date
        const [year, month, day] = date.split('-').map(part => parseInt(part, 10));
        // Month in JS is 0-indexed, so we subtract 1
        const selectedDate = new Date(year, month - 1, day);
        console.log(`Selecting date: ${selectedDate.toDateString()}...`);

        // Navigate to the target month
        let currentMonthYear: string = '';
        while (true) {
            // Get current visible month/year
            const monthYearText = await page.evaluate(() => {
                const monthElement = document.querySelector('.calendar-body__header');
                return monthElement ? monthElement.textContent : '';
            });

            // Handle potential null value
            currentMonthYear = monthYearText || '';
            console.log(`Current month in calendar: ${currentMonthYear}`);

            // If month contains our target month and year, break the loop
            const targetMonth = selectedDate.toLocaleString('default', { month: 'long' });
            const targetYear = selectedDate.getFullYear();
            if (currentMonthYear.includes(targetMonth) && currentMonthYear.includes(targetYear.toString())) {
                break;
            }

            // Click next month button
            console.log('Clicking next month button...');
            await page.click('[data-ref="calendar-btn-next-month"]');
            // Use page.waitForTimeout replacement
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for animation
        }

        // Format day for selecting (remove leading zero if present)
        const formattedDay = day.toString();

        // Select the day
        console.log(`Selecting day: ${formattedDay}...`);
        const daySelector = await page.$$(`div[data-id="${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"] .calendar-body__cell`);

        if (daySelector.length > 0) {
            await daySelector[0].click();
        } else {
            throw new Error(`Could not find the requested date: ${date}`);
        }

        // Click search button
        console.log('Clicking search button...');
        await page.waitForSelector('[data-ref="flight-search-widget__cta"]', { visible: true });
        await page.click('[data-ref="flight-search-widget__cta"]');

        // Wait for results page to load
        console.log('Waiting for results page to load...');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Wait for flight cards to appear
        await page.waitForSelector('.flight-card__wrapper', { timeout: 30000 });

        // Define the flight data interface
        interface FlightData {
            flightNumber: string;
            departureTime: string;
            arrivalTime: string;
            price: string;
            currency: string;
        }

        // Extract flight information and prices
        console.log('Extracting flight information...');
        const flights: FlightData[] = await page.evaluate(() => {
            const flightCards = Array.from(document.querySelectorAll('.flight-card__wrapper'));

            return flightCards.map(card => {
                // Extract departure and arrival times
                const times = Array.from(card.querySelectorAll('.flight-card__time'));
                const departureTime = times[0]?.textContent?.trim() || 'N/A';
                const arrivalTime = times[1]?.textContent?.trim() || 'N/A';

                // Extract flight number
                const flightNumber = card.querySelector('.flight-card__flight-number')?.textContent?.trim() || 'N/A';

                // Extract price
                const priceElement = card.querySelector('.flight-card-summary__price');
                let price = 'N/A';
                if (priceElement) {
                    price = priceElement.textContent?.trim() || 'N/A';
                }

                // Extract currency
                const currencyElement = card.querySelector('.price__currency');
                const currency = currencyElement?.textContent?.trim() || '£';

                return {
                    flightNumber,
                    departureTime,
                    arrivalTime,
                    price,
                    currency
                };
            });
        });

        console.log(`Found ${flights.length} flights for ${origin} to ${destination} on ${date}`);
        return flights;
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

        console.log(`Checking flights from ${origin} to ${destination} on ${date}`);
        const flightPrices = await checkRyanairPrice(origin, destination, date);

        // Display the results
        console.log('\nFlight Prices:');
        console.table(flightPrices);

        // Define flight type for properly typed parameters
        interface FlightData {
            flightNumber: string;
            departureTime: string;
            arrivalTime: string;
            price: string;
            currency: string;
        }

        // Find the cheapest flight
        if (flightPrices.length > 0) {
            const cheapestFlight = flightPrices.reduce((min: FlightData, flight: FlightData) => {
                const priceA = parseFloat(min.price.replace(/[^0-9.]/g, '')) || Infinity;
                const priceB = parseFloat(flight.price.replace(/[^0-9.]/g, '')) || Infinity;
                return priceA < priceB ? min : flight;
            });

            console.log(`\nCheapest flight: ${cheapestFlight.flightNumber} at ${cheapestFlight.price} ${cheapestFlight.currency}`);
            console.log(`Departure: ${cheapestFlight.departureTime}, Arrival: ${cheapestFlight.arrivalTime}`);
        } else {
            console.log('No flights found for this date.');
        }
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

// Run the script
main().catch(console.error);