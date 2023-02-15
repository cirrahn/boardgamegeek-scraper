import fs from "fs";
import sanitizeHtml from 'sanitize-html';


class BggApiClient {
	static _PAGE_LIMIT_LIST = 50;

	static async pGetTopCoopGames ({count = 500} = {}) {
		return (await Promise.all(
			[...new Array(Math.ceil(count / this._PAGE_LIMIT_LIST))]
				.map(async (_, i) => {
					return (await (await fetch(`https://api.geekdo.com/api/geekitem/linkeditems?ajax=1&linkdata_index=boardgame&nosession=1&objectid=2023&objecttype=property&pageid=${i + 1}&showcount=${this._PAGE_LIMIT_LIST}&sort=rank&subtype=boardgamemechanic`)).json()).items;
				})
		)).flat();
	}

	static async pGetGameDetails (gameId) {
		const html = await (await fetch(`https://boardgamegeek.com/boardgame/${gameId}`)).text();
		const line = html.split("\n").find(it => /^GEEK\.geekitemPreload/.test(it.trim()));
		const raw = JSON.parse(line.trim().replace(/^GEEK\.geekitemPreload = /, "").slice(0, -1));

		const rawItemProps = [
			"name",
			"yearpublished",
			"href",
			"minplayers",
			"maxplayers",
			"minplaytime",
			"maxplaytime",
			"minage",
			"stats",
			"rankinfo",
			"polls",
			"short_description",
			"description",
			"imageurl",
		];

		return {
			...rawItemProps.map(prop => ({[prop]: raw.item[prop]})).reduce((a, b) => Object.assign(a, b), {}),
		};
	}

	static getFullLink (href) {
		return `https://boardgamegeek.com${href}`;
	}
}

const MAX_RELEASE_YEAR_AGE = 10;
const MIN_PLAYERS = 6;
const MIN_COMPLEXITY = 2.25;
const MIN_AGE = 12;
const MIN_RATING = 6.9;

async function main () {
	const out = await pGetGames();

	const outFilt = out
		.filter(detail => detail.polls.boardgameweight.averageweight >= MIN_COMPLEXITY)
		.filter(detail => Number(detail.minage) >= MIN_AGE)
		.filter(detail => Number(detail.stats.average) >= MIN_RATING)
		.sort((a, b) => a.rankinfo[0].rank.localeCompare(b.rankinfo[0].rank, undefined, {numeric: true}));

	console.log(`Filtered down to ${outFilt.length} games after applying complexity/age/etc.`);

	doFileOutput(outFilt);
	doHtmlOutput(outFilt);
}

async function pGetGames () {
	const PATH_DUMP = `out/dump-games.json`

	if (fs.existsSync(PATH_DUMP)) return JSON.parse(fs.readFileSync(PATH_DUMP, "utf-8"));

	const minDate = new Date()
	minDate.setFullYear(minDate.getFullYear() - MAX_RELEASE_YEAR_AGE)
	minDate.setMilliseconds(0);

	const games = (await BggApiClient.pGetTopCoopGames())
		.filter(game => new Date(game.yearpublished) >= minDate);

	const out = [];
	let cnt = 0;

	const workers = [...new Array(8)]
		.map(async () => {
			while (games.length) {
				const game = games.shift();

				if ((++cnt) % 50 === 0) console.log(`Processed ${cnt} games...`);

				const details = await BggApiClient.pGetGameDetails(game.objectid);

				const maxPlayers = details.maxplayers;
				if (isNaN(maxPlayers)) {
					console.error(`!Max players for "${game.name}" (${BggApiClient.getFullLink(game.href)}) was not a number!`);
					continue;
				}

				if (maxPlayers < MIN_PLAYERS) continue;
				console.log(`\tFound ${maxPlayers} player game: ${game.name} (${game.yearpublished})`);

				out.push(details);
			}
		});
	await Promise.all(workers);

	fs.writeFileSync(PATH_DUMP, JSON.stringify(out, null, "\t"), "utf-8");

	return out;
}

function doFileOutput (outFilt) {
	fs.writeFileSync(`out/games.json`, JSON.stringify(outFilt, null, "\t"), "utf-8");
}

function doHtmlOutput (outFilt) {
	const template = fs.readFileSync(`template.html`, "utf-8");

	const htmlRows = outFilt.map(detail => {
		const linkName = detail.name.toLowerCase().trim()
			.replace(/[^a-z ]/g, " ")
			.replace(/\s+/g, "+");

		const rating = Number(detail.stats.average);

		return `<div>
			<h4><span title="Rating" class="${rating >= 8 ? "bg-success" : "bg-primary"} text-white px-1">${rating.toFixed(1)}</span> <a href="${BggApiClient.getFullLink(detail.href)}">${detail.name}</a> (${detail.yearpublished})</h4>
			<div>Buy: <a href="https://www.amazon.co.uk/s?k=${linkName}+board+game">Amazon</a> | <a href="https://www.ebay.co.uk/sch/i.html?_nkw=${linkName}&rt=nc&LH_BIN=1">eBay</a></div>
			<div>Players: ${detail.minplayers}-${detail.maxplayers} | Playtime: ${detail.minplaytime}-${detail.maxplaytime} mins | Complexity: ${Number(detail.polls.boardgameweight.averageweight).toFixed(2)}</div>
			<p><i>${detail.short_description}</i></p>
			<img src="${detail.imageurl}">
			<section>
				${sanitizeHtml(detail.description)}
			</section>
			<hr>
		</div>`
	}).join("\n")

	const page = template.replace(/\$CONTENT\$/, htmlRows);

	fs.writeFileSync(`dist/index.html`, page, "utf-8");
}

main()
	.then(() => console.log("Done!"))
	.catch(e => { throw e; })

