var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
});

var mvcBuilder = builder.Services.AddControllersWithViews();

#if DEBUG
mvcBuilder.AddRazorRuntimeCompilation();
#endif

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseResponseCompression();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // css/js links use asp-append-version, audio/fonts rarely change
        ctx.Context.Response.Headers.CacheControl = "public,max-age=604800";
    }
});

app.UseRouting();

app.UseAuthorization();

app.MapRazorPages();

app.Run();
