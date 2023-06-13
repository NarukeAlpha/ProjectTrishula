package monitorService

import (
	"log"

	"github.com/playwright-community/playwright-go"
)

func main() {
	pw, err := playwright.Run()
	if err != nil {
		log.Fatal(err)
	}
	defer pw.Stop()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(false),
	})
	if err != nil {
		log.Fatal(err)
	}
	defer browser.Close()

	context, err := browser.NewContext()
	if err != nil {
		log.Fatal(err)
	}
	defer context.Close()

	page, err := context.NewPage()
	if err != nil {
		log.Fatal(err)
	}

	if _, err := page.Goto("https://www.asurascans.com/to-hell-with-being-a-saint-im-a-doctor-chapter-50/"); err != nil {
		log.Fatal(err)
	}

	// Get all available options in the dropdown
	options, err := page.QuerySelectorAll("#chapter option")
	if err != nil {
		log.Fatal(err)
	}

	// Collect option texts
	var optionTexts []string
	for _, option := range options {
		optionText, err := option.TextContent()
		if err != nil {
			log.Fatal(err)
		}
		optionTexts = append(optionTexts, optionText)
	}

	// Print all available option texts
	for _, optionText := range optionTexts {
		log.Println(optionText)
	}
}
