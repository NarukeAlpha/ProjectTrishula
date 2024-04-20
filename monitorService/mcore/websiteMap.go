package mcore

import (
	"log"
	"time"

	"github.com/playwright-community/playwright-go"
)

var theMap = map[string]func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool{

	"asurascans": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool {
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Panicf("Couldn't hit webpage chapter specific link: %v \n err: %v", clink, err)

		}
		// Get the element with the class "ch-next-btn disabled"
		element, err := page.QuerySelector(".ch-next-btn.disabled")
		if err != nil {
			log.Panicf("Failed to select element: %v", err)
		}

		// Check if the element is present
		if element != nil {
			log.Printf("Next chapter is not available")
			return false
		} else {
			// Get the button with the class "ch-next-btn"
			button, err := page.QuerySelector(".ch-next-btn")
			if err != nil {
				log.Panicf("Failed to select button: %v", err)
			}
			// Click the button
			if button != nil {
				err = button.Click()
				if err != nil {
					log.Panicf("Failed to click button: %v", err)
				}
				time.Sleep(1500)
				if page.URL() != manga.DchapterLink {
					title, err := page.Title()
					if err != nil {
						log.Panicf("Couldn't get page title: %v \n err: %v", manga.DchapterLink, err)

					}
					if !titleHas404(title) {
						return true
					}

				}
			} else {
				log.Println("Button is not present")
			}
		}
		return false

	},
}
