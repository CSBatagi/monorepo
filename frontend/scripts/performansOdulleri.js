const PerformansOdulleri = (() => {
    const NIGHT_AVG_JSON_URL = 'data/night_avg.json?_cb=' + Date.now(); // Ensure fresh data
    const AWARDS_START_DATE = new Date('2025-05-08T00:00:00Z'); // Using a fixed year for consistent testing; original issue implies current year. For production, this should be dynamic or correctly set.

    let lastCalculatedPeriod = null;
    let cachedAwardsData = null;

    // DOM Element References
    let donemSpan;
    let topPerformersDiv;
    let bottomPerformersDiv;

    function getTwoWeekPeriod(currentDate) {
        let startDate = new Date(AWARDS_START_DATE);
        
        // Adjust startDate to be in the past relative to currentDate if necessary for calculation
        while (startDate > currentDate) {
            startDate.setDate(startDate.getDate() - 14); // Go back two weeks
        }

        // Find the current period's start date
        while (new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000 - 1) < currentDate) { // -1ms to ensure end of day
            startDate.setDate(startDate.getDate() + 14);
        }
        
        const endDate = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000 - 1); // End of the 14th day

        // Format dates as YYYY-MM-DD for JSON matching and display
        const formatDate = (date) => date.toISOString().split('T')[0];
        
        return {
            start: startDate, // Date object
            end: endDate,     // Date object
            displayStart: formatDate(startDate),
            displayEnd: formatDate(endDate),
            key: `${formatDate(startDate)}_${formatDate(endDate)}` // Unique key for the period
        };
    }

    async function fetchData() {
        try {
            const response = await fetch(NIGHT_AVG_JSON_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error("Error fetching night_avg.json:", error);
            if (donemSpan) donemSpan.textContent = "Veri yüklenemedi.";
            return null;
        }
    }

    function calculateAwards(allData, period) {
        const periodPlayerData = {};

        for (const dateStr in allData) {
            const gameDate = new Date(dateStr + 'T00:00:00Z'); // Assume Z timezone for consistency
            if (gameDate >= period.start && gameDate <= period.end) {
                allData[dateStr].forEach(playerStats => {
                    const steamId = playerStats.steam_id;
                    if (!periodPlayerData[steamId]) {
                        periodPlayerData[steamId] = {
                            name: playerStats.name,
                            totalHltvDiff: 0,
                            totalAdrDiff: 0,
                            gameCount: 0
                        };
                    }
                    periodPlayerData[steamId].totalHltvDiff += (parseFloat(playerStats['HLTV2 DIFF']) || 0);
                    periodPlayerData[steamId].totalAdrDiff += (parseFloat(playerStats['ADR DIFF']) || 0);
                    periodPlayerData[steamId].gameCount++;
                });
            }
        }

        const aggregatedPlayers = Object.values(periodPlayerData).map(player => ({
            ...player,
            // Lower score is better for bottom, higher for top.
            // We sum HLTV2 Diff and ADR Diff. Issue implies summing them up.
            // A positive diff means player performed better than average.
            // A negative diff means player performed worse than average.
            // So, for Top 3, we want highest sum. For Bottom 3, we want lowest sum.
            performanceScore: player.totalHltvDiff + player.totalAdrDiff 
        }));

        // Sort by performance score. Higher score is better.
        aggregatedPlayers.sort((a, b) => b.performanceScore - a.performanceScore);
        
        const top3 = aggregatedPlayers.slice(0, 3);
        // For bottom 3, we take from the other end of the sorted list
        const bottom3 = aggregatedPlayers.slice(-3).reverse(); // reverse to show worst first if desired, or keep as is

        return { top3, bottom3 };
    }

    function displayAwards(awards, period) {
        if (donemSpan) {
            donemSpan.textContent = `${period.displayStart} - ${period.displayEnd}`;
        }

        const populateList = (element, players, type) => {
            if (!element) return;
            element.innerHTML = ''; // Clear previous entries
            if (players.length === 0) {
                element.innerHTML = `<p class="text-gray-500">Bu dönem için ${type} performans gösteren oyuncu bulunmuyor.</p>`;
                return;
            }
            const ul = document.createElement('ul');
            ul.className = 'list-disc pl-5 space-y-1';
            players.forEach(player => {
                const li = document.createElement('li');
                li.className = 'text-gray-700';
                // Format score to 2 decimal places
                const scoreFormatted = player.performanceScore.toFixed(2);
                li.textContent = `${player.name}: Skor ${scoreFormatted} (HLTV Diff: ${player.totalHltvDiff.toFixed(2)}, ADR Diff: ${player.totalAdrDiff.toFixed(2)}, Maç: ${player.gameCount})`;
                ul.appendChild(li);
            });
            element.appendChild(ul);
        };

        populateList(topPerformersDiv, awards.top3, 'en iyi');
        populateList(bottomPerformersDiv, awards.bottom3, 'en düşük');
    }

    async function init() {
        // Initialize DOM element references once the DOM is ready for this script
        donemSpan = document.getElementById('performans-odulleri-donem');
        topPerformersDiv = document.getElementById('top-performers');
        bottomPerformersDiv = document.getElementById('bottom-performers');

        if (!donemSpan || !topPerformersDiv || !bottomPerformersDiv) {
            console.error("Performans Odulleri DOM elements not found.");
            return;
        }
        
        // Use a fixed date for testing to ensure periods are calculated predictably
        // For production, use new Date()
        const currentDate = new Date(); // Or a fixed date for testing: new Date('2025-05-22T10:00:00Z')
        const currentPeriod = getTwoWeekPeriod(currentDate);

        if (cachedAwardsData && lastCalculatedPeriod && lastCalculatedPeriod.key === currentPeriod.key) {
            console.log("Displaying cached performance awards for period:", currentPeriod.key);
            displayAwards(cachedAwardsData, currentPeriod);
        } else {
            console.log("Calculating new performance awards for period:", currentPeriod.key);
            const allData = await fetchData();
            if (allData) {
                const awards = calculateAwards(allData, currentPeriod);
                cachedAwardsData = awards;
                lastCalculatedPeriod = currentPeriod;
                displayAwards(awards, currentPeriod);
                // Here you could optionally save `cachedAwardsData` and `lastCalculatedPeriod.key` 
                // to localStorage if you want to persist cache across page reloads/sessions.
                // For now, it's an in-memory cache for the session.
            } else {
                 if (donemSpan) donemSpan.textContent = "Veri alınamadı.";
                 if (topPerformersDiv) topPerformersDiv.innerHTML = '<p class="text-gray-500">Veri alınamadı.</p>';
                 if (bottomPerformersDiv) bottomPerformersDiv.innerHTML = '<p class="text-gray-500">Veri alınamadı.</p>';
            }
        }
    }
    
    // Public API
    return {
        init: init
    };
})();
