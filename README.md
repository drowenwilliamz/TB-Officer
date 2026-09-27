# Territory Battle Analyser

A static, browser-based version of the MATLAB Territory Battle report app. Guild members see a read-only report; the report owner uses a separate publisher page.

## Run it

Serve this folder from any static web host such as GitHub Pages. `index.html` is the public report. For local testing, run a small static file server in this directory rather than opening the file directly.

Open `publisher.html`, then:

1. Add the TB activity export (`tb_data.csv`).
2. Add the guild roster export (normally `Open Armed New RepublicFull.csv`; the filename is not important).
3. Select a phase range and choose **Analyse TB**.
4. Choose **Download publish file**.
5. Replace `report-data.json` in the hosted repository with the downloaded file, then commit and push it using GitHub Desktop.

Both source CSV files are processed locally in the browser. They are not published or uploaded by this app. Guild members only receive the derived values in `report-data.json`.

## Performance history

The app stores completed P2-P6 snapshots in browser storage. Use **Import existing log** to load `TB_Performance_Log.csv`, and **Export performance log** to create a portable backup. Analyses that do not include the complete P2-P6 window cannot be added to the log.

## Hosting

The app has no build step or server dependencies. Publish the contents of this directory as the root of a GitHub Pages site.
