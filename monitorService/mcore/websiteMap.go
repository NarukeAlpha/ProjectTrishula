package mcore

import (
	"github.com/playwright-community/playwright-go"
	"log"
)

var theMap = map[string]func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool{

	"asurascans": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool {
		if _, err := page.Goto(manga.DchapterLink); err != nil {
			log.Printf("Couldn't hit webpage chapter specific link: %v \n err: %v", clink, err)
			panic(err)
		}
		options, err := page.QuerySelectorAll("#chapter option")
		if err != nil {
			log.Panicf("Failed to load #chapter option selector on page : %v", err)
		}
		var optionTexts []string
		for _, option := range options {
			optionText, err := option.TextContent()
			if err != nil {
				log.Panicf("optionstext errored out traversing through the array :%v", err)
			}
			optionTexts = append(optionTexts, optionText)
		}
		for x := 0; x < len(optionTexts); x++ {
			if ChapterRegex(optionTexts[x], manga.DlastChapter) {
				if _, err := page.Goto(clink); err != nil {
					log.Printf("Couldn't hit webpage chapter specific link \n after finding new chapter in chapter selector: %v \n err: %v", clink, err)
					return false
				}
				title, err := page.Title()
				if err != nil {
					log.Printf("Couldn't get page title: %v \n err: %v", clink, err)
					return false
				}
				if titleHas404(title) {
					return true
				} else {
					return false
				}

			}

		}
		return false

	},
	"readeleceed": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool {
		if page.URL() != manga.DchapterLink {
			if _, err := page.Goto(manga.DchapterLink); err != nil {
				log.Printf("Proxy is being rate limited")
			}
			if page.URL() != manga.DchapterLink {
				log.Printf("Proxy is being rate limited")

			}

		}
		countdownIdentifier, _ := page.QuerySelectorAll(identifier)
		if countdownIdentifier == nil {
			log.Printf("Failed to create slice of countdown elements")
			return false
		} else if len(countdownIdentifier) == 0 {
			return true

		} else {
			return false
		}
	},
	"mangasee123": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool {
		_, err := page.Goto(manga.DchapterLink)
		if err != nil {
			log.Printf("coudln't hit webpage chapter : %v", err)
		}
		return false
		//
		//using Microsoft.Playwright;
		//using System;
		//using System.Threading.Tasks;
		//
		//class Program
		//{
		//	public static async Task Main()
		//	{
		//		using var playwright = await Playwright.CreateAsync();
		//		await using var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
		//		{
		//			Headless = false,
		//		});
		//		var context = await browser.NewContextAsync();
		//
		//		var page = await context.NewPageAsync();
		//
		//		await page.GotoAsync("https://mangasee123.com/read-online/Jujutsu-Kaisen-chapter-225.html");
		//
		//		await page.Locator("a").Filter(new() { HasText = "225" }).ClickAsync();
		//
		//		await page.GetByRole(AriaRole.Link, new() { Name = "Chapter " }).ClickAsync();
		//
		//		await page.Locator("a").Filter(new() { HasText = "226" }).ClickAsync();
		//
		//		await page.GetByRole(AriaRole.Link, new() { Name = "Chapter " }).ClickAsync();
		//
		//	}
		//}

	},
	"legendasura": func(manga DbMangaEntry, browser playwright.BrowserContext, page playwright.Page, clink string) bool {
		return false
	},
}
