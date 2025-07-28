# 🪪 ID Card Generator Figma Plugin

This Figma plugin helps you **automatically generate ID cards** using a CSV file and image assets. It's perfect for schools, companies, or any organization that needs to generate multiple ID cards efficiently.

---

## 🚀 Features

- ✅ Upload a CSV file with user data
- 🖼 Upload image files for photos
- 🧠 Auto maps CSV columns to Figma layer names
- 📄 Generates ID cards dynamically using your Figma template
- ✂️ Supports auto-resizing of text
- ⚡ Fast & efficient – generate dozens of cards in seconds

---

## 🛠️ How to Use

### 1. **Prepare Your CSV File**

Make sure your CSV contains column headers like:

```csv
name,designation,photo,id,department
John Doe,Software Engineer,john_doe.jpg,EMP001,Engineering
Jane Smith,UI Designer,jane_smith.jpg,EMP002,Design
````

> ✅ **Note:**
>
> * The **column headers must exactly match** the Figma layer names (e.g., "name", "designation", "photo", etc.)
> * The `photo` column should contain the **image file names** (e.g., `john_doe.jpg`)

---

### 2. **Design Your Template in Figma**

* Create a frame or component as your **ID card template**
* Use **text layers** and **image placeholders**
* Name each layer **exactly the same** as the CSV column headers

  * Example: If your CSV column is `name`, then layer name should also be `name`
  * For photo, use an image placeholder and name it `photo`

---

### 3. **Run the Plugin**

1. Open the plugin from the Figma plugins menu
2. Click **"Upload CSV"** and choose your CSV file
3. Click **"Upload Images"** and select all the matching images
4. The plugin will:

   * Read the CSV file
   * Match images using the `photo` column
   * Clone your ID card template
   * Fill in the text and image fields for each row

---

### 4. ✅ Done!

Your ID cards will be auto-generated below your template. You can then:

* Move them into a grid
* Export as PDF or PNG
* Print or share directly from Figma

---

## 📁 Folder Structure (Optional)

We recommend organizing your files like this before uploading:

```
📂 assets/
 ├── john_doe.jpg
 ├── jane_smith.jpg
📄 employees.csv
```

---

## 🧠 Tips

* Use **auto layout** in your template for dynamic sizing
* Use `Text > Auto Width` to avoid overflow
* Keep image file names **exactly the same** as in the `photo` column
* You can include any number of columns, just match their names with layer names

---

## ❓ FAQ

**Q: Can I use PNG or JPG images?**
Yes! JPG and PNG, are supported.

**Q: What happens if an image file is missing?**
That entry will be skipped or shown as blank (The specific file will empty.).

**Q: Can I style individual cards differently?**
Not yet — all cards use the same design template. But you can customize after generation.

---

## 💬 Support

If you have any questions or feature requests, feel free to open an issue or contact us.

---

## 🧑‍💻 Author

Developed by \[Muktadir Hossain]
🔗 \[[Github Profile](https://github.com/muktadirhossain?tab=repositories)]

---

## 🪄 License

This plugin is open source under the [MIT License](LICENSE).

```

---

Let me know if you want me to:
- add screenshots
- write a short demo video script
- create a version for the Figma plugin store

Also, if you have a plugin name, I can update it in the title and everywhere else.
