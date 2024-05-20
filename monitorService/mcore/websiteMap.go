package mcore

import (
	"log"
	"time"

	"github.com/playwright-community/playwright-go"
)

var theMap = map[string]func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool{

	"asurascans": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool {
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Panicf("Couldn't hit webpage chapter specific link: %v \n err: %v", manga.DchapterLink, err)

		}

		//removing add iframes
		err := page.FrameLocator(`iframe[name="aswift_3]`).FrameLocator(`iframe[name="ad_iframe"]`).GetByLabel("Close ad").Click()
		if err != nil {
			log.Println("No ad iframe found")
		}
		err = page.Locator("svg").Click()
		if err != nil {
			log.Println("No svg found")
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
			button := page.Locator("#manga-reading-nav-head").GetByRole("link", playwright.LocatorGetByRoleOptions{
				Name: "\uF287 Next",
			})
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
