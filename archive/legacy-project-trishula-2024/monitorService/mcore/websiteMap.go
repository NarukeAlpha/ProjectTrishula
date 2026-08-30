package mcore

import (
	"errors"
	"log"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"
)

var theMap = map[string]func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool{

	"asurascans": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Recovered from panic: %v", err)
			}
		}()
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Panicf("Couldn't hit webpage chapter specific link: %v \n err: %v", manga.DchapterLink, err)

		}
		log.Println("Loading webpage")

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
			buttoncount, err := button.Count()
			if err != nil {
				log.Panicf("Failed to count buttons: %v", err)
			}

			// Click the button
			if buttoncount > 0 {
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
	"hivescans": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Recovered from panic: %v", err)
			}
		}()
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Println("loading webpage")
			if errors.Is(err, playwright.ErrTimeout) {
				pageLoaded, err2 := page.InnerText("Body")
				if err2 != nil {
					log.Panicf("Failed to get inner text : %v", err2)
				}
				if !strings.Contains(pageLoaded, "Leave a Reply") {
					log.Println("Page did not load within the 30 seconds time out period, returning false")
					return false
				}
			} else {
				log.Panicf("Couldn't hit webpage chapter specific link: %v \n err: %v", manga.DchapterLink, err)
			}
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
		}
		// Check if the element is present
		button := page.GetByRole("link", playwright.PageGetByRoleOptions{Name: "Next \uF105"})
		buttoncount, err := button.Count()
		if err != nil {
			log.Panicf("Failed to count buttons: %v", err)
		}
		if buttoncount > 0 {
			err = button.First().Click()
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

		}

		return false

	},
	"toongod": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Recovered from panic: %v", err)
			}
		}()
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Panicf("Couldn't hit webpage chapter specific link: %v \n err: %v", manga.DchapterLink, err)

		}
		log.Println("Loaded webpage, waiting 5 seconds before checking for cloudflare")
		time.Sleep(9 * time.Second)

		if pageHastext(page, "unblock challenges.cloudflare.com") {
			log.Println("Cloudflare detected, tapping screen to bypass")
			viewport := page.ViewportSize()
			x := viewport.Width/2 + 24
			y := viewport.Height/2 + 37
			err := page.Touchscreen().Tap(x, y)
			if err != nil {
				log.Panicf("Failed to tap: %v", err)
			}
			time.Sleep(1374)
			err = page.Click("body", playwright.PageClickOptions{
				Button: playwright.MouseButtonRight,
			})
			if err != nil {
				log.Panicf("Failed to click: %v", err)
			}
			err = page.Keyboard().Press("Tab")
			if err != nil {
				log.Panicf("Failed to press tab: %v", err)
			}
			err = page.Keyboard().Press("Enter")
			if err != nil {
				log.Panicf("Failed to press enter: %v", err)

			}
		}

		time.Sleep(2344)

		button := page.Locator("#manga-reading-nav-head").GetByRole("link", playwright.LocatorGetByRoleOptions{
			Name: "\uF287 Next",
		})
		buttoncount, err := button.Count()
		if err != nil {
			log.Panicf("Failed to count buttons: %v", err)
		}

		// Click the button
		if buttoncount > 0 {
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

		return false
	},
	"asuracomic": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page) bool {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("Recovered from panic: %v", err)
			}
		}()
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Println("loading webpage")
			if errors.Is(err, playwright.ErrTimeout) {
				pageLoaded, err2 := page.InnerText("Body")
				if err2 != nil {
					log.Panicf("Failed to get inner text : %v", err2)
				}
				if !strings.Contains(pageLoaded, "Comment") {
					log.Println("Page did not load within the 30 seconds time out period, returning false")
					return false
				}
			} else {
				log.Panicf("Couldn't hit webpage chapter specific link: %v \n err: %v", manga.DchapterLink, err)
			}
		}
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
			//button := page.Locator("#manga-reading-nav-head").GetByRole("link", playwright.LocatorGetByRoleOptions{
			//	Name: "Next \uF105",
			//})
			button := page.GetByRole("link", playwright.PageGetByRoleOptions{Name: "Next \uF105"})
			buttoncount, err := button.Count()
			if err != nil {
				log.Panicf("Failed to count buttons: %v", err)
			}

			// Click the button
			if buttoncount > 0 {
				err = button.First().Click()
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
