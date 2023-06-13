package Core

import (
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

func ProxyLoad(c chan []ProxyStruct, wg *sync.WaitGroup) {
	defer wg.Done()
	var returnPS []ProxyStruct
	var path = "./ProxyList.csv"
	f, err := os.Open(path)
	if err != nil {
		log.Fatalf("couldn't open - err: %v", err)
	}
	defer f.Close()
	csvReader := csv.NewReader(f)
	for i := 0; true; i++ {
		if i == 0 {
			fmt.Println("Loading proxies")
			_, err := csvReader.Read()
			if err != nil {
				log.Fatalf("failed to open csv - err: %v", err)
			}

		} else {
			rec, err := csvReader.Read()
			if err == io.EOF {
				break
			} else if err != nil {
				log.Fatalf("CSV reader failed - err : %v", err)
			}
			fmt.Printf("%+v \n", rec)
			split := strings.Split(rec[0], ":")
			fmt.Printf(" proxy string %v \n", split)
			srv := (split[0] + ":" + split[1])
			usr := split[2]
			pss := split[3]

			var accDataStrct = ProxyStruct{
				ip:  srv,
				usr: usr,
				pw:  pss,
			}
			returnPS = append(returnPS, accDataStrct)

		}

	}
	c <- returnPS
	return
}

func ChapterLinkIncrementer(chapterLink string, chapterNumber int) string {
	pattern := strconv.Itoa(chapterNumber)
	re := regexp.MustCompile(pattern)
	match := re.FindString(chapterLink)
	var trgChapterNumber int = chapterNumber + 1

	if match != "" {
		replacement := strconv.Itoa(trgChapterNumber)
		result := re.ReplaceAllString(chapterLink, replacement)
		return result
	}
	log.Printf("ChapterLinkIncrementer failed - err: %v", "no match found")
	return "error"

}

func IdentifierDeRegex(identifier string) string {
	pattern := "%20"
	re := regexp.MustCompile(pattern)
	var result = re.ReplaceAllString(identifier, "'")
	return result
}

func titleHas404(title string) bool {
	title = strings.ToLower(title)
	strings.Contains(title, "Page Not Found")
	if strings.Contains(title, "page not found") {
		return true
	}
	return false
}

func ChapterRegex(chapterString string, chapterNumber int) bool {
	chpn := chapterNumber + 1
	pattern := strconv.Itoa(chpn)
	re := regexp.MustCompile(pattern)
	match := re.FindString(chapterString)
	if match != "" {
		return true
	}
	return false
}
